import { afterAll, describe, expect, it } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { handleGenerateReplyDraft } from '../src/handlers/generateReplyDraft';
import {
  agentRuns,
  agentTasks,
  approvals,
  clients,
  conversations,
  createTask,
  db,
  drafts as draftsTable,
  getDraftById,
  getOwnerUserId,
  getTaskById,
  insertClient,
  insertConversation,
  listDrafts,
} from '@client-agent/db';
import { TaskType } from '@client-agent/domain';
import { STREAMS } from '@client-agent/queue';
import {
  createInteractionRouter,
  handleDraftButtonInteraction,
  handleDraftModalSubmitInteraction,
} from '@client-agent/discord';
import { createDefaultDraftInteractionDeps } from '../src/bot';

describe('Generate Reply Draft Worker Integration', () => {
  const createdTaskIds: number[] = [];
  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdDraftIds: number[] = [];

  afterAll(async () => {
    if (createdDraftIds.length > 0) {
      await db.delete(approvals).where(inArray(approvals.draftId, createdDraftIds));
      await db.delete(draftsTable).where(inArray(draftsTable.id, createdDraftIds));
    }
    if (createdConversationIds.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
    }
    if (createdClientIds.length > 0) {
      await db.delete(clients).where(inArray(clients.id, createdClientIds));
    }
    if (createdTaskIds.length > 0) {
      await db.delete(agentRuns).where(inArray(agentRuns.taskId, createdTaskIds));
      await db.delete(agentTasks).where(inArray(agentTasks.id, createdTaskIds));
    }
  });

  it('generates draft, saves to drafts table, and emits Discord message with buttons', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `reply_test_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `reply_conv_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: client.username,
        instruction: 'Confirm commission slot for next month',
        discord: {
          applicationId: 'app123',
          interactionToken: 'token123',
        },
      },
      idempotencyKey: `reply_task_${Date.now()}`,
    });
    createdTaskIds.push(task.id);

    let sentComponents: any = null;
    let sentContent: string = '';

    const mockAiClient: any = {
      createChatCompletion: async () => ({
        content: 'Hi! I can confirm your commission slot for next month.',
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        durationMs: 120,
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      }),
    };

    const mockMessenger: any = {
      editInteractionFollowup: async ({ content, components }: any) => {
        sentContent = content;
        sentComponents = components;
        return { messageId: 'msg-1' };
      },
    };

    await handleGenerateReplyDraft(
      {
        id: 'stream-1',
        data: { taskId: String(task.id) },
      },
      {
        aiClient: mockAiClient,
        messenger: mockMessenger,
      },
    );

    // 1. Verify drafts row created in DB
    const drafts = await listDrafts({ conversationId: conv.id });
    expect(drafts.length).toBe(1);
    const draft = drafts[0]!;
    expect(draft.status).toBe('pending_approval');
    expect(draft.content).toContain('confirm your commission slot');
    createdDraftIds.push(draft.id);

    // 2. Verify Discord message had action buttons
    expect(sentComponents).toBeDefined();
    expect(sentContent).toContain(client.username);

    // 3. Verify task output contains draftId
    const completedTask = await getTaskById(task.id);
    expect(completedTask?.output).toBeDefined();
    expect((completedTask?.output as any).draftId).toBe(draft.id);

    // 4. Test button approval interaction through bot routing
    let publishedStream: any = null;
    let publishedPayload: any = null;
    let publishCallCount = 0;
    const mockPublisher = async (stream: string, payload: Record<string, unknown>) => {
      publishedStream = stream;
      publishedPayload = payload;
      publishCallCount++;
      return 'mock-msg-id';
    };

    const draftDeps = createDefaultDraftInteractionDeps({ publisher: mockPublisher });
    let updatedMessage: any = null;
    const approveInteraction: any = {
      isButton: () => true,
      isChatInputCommand: () => false,
      isModalSubmit: () => false,
      customId: `approve_draft:${draft.id}`,
      user: { id: 'discord-user-1', username: 'TestCreator' },
      message: { content: sentContent },
      update: async (data: any) => {
        updatedMessage = data;
      },
    };

    const router = createInteractionRouter({
      commands: {},
      onButton: async (interaction: any) => {
        if (interaction.customId.includes('_draft:')) {
          await handleDraftButtonInteraction(interaction, draftDeps);
        }
      },
      onModalSubmit: async (interaction: any) => {
        if (interaction.customId.startsWith('modal_edit_draft:')) {
          await handleDraftModalSubmitInteraction(interaction, draftDeps);
        }
      },
    });

    await router(approveInteraction);
    const approvedDraft = await getDraftById(draft.id);
    expect(approvedDraft?.status).toBe('approved');
    expect(updatedMessage?.content).toContain('✅ Approved by TestCreator — ⏳ Sending to VGen...');
    expect((updatedMessage?.components[0]?.components[0]?.data as any).label).toBe('✅ Approved — Sending...');
    expect(publishedStream).toBe(STREAMS.SEND);
    expect(publishedPayload).toBeDefined();
    expect(publishedPayload?.draftId).toBe(String(draft.id));
    expect(publishCallCount).toBe(1);
    if (publishedPayload?.taskId) {
      createdTaskIds.push(Number(publishedPayload.taskId));
    }

    // Calling sendDraft a second time for the same draft must be idempotent and not re-publish
    await draftDeps.sendDraft!({ draftId: draft.id, userId: 'discord-user-1' });
    expect(publishCallCount).toBe(1);

    // 5. Test modal edit interaction through bot routing (should revert to pending_approval)
    let modalUpdatedMessage: any = null;
    const modalInteraction: any = {
      isButton: () => false,
      isChatInputCommand: () => false,
      isModalSubmit: () => true,
      customId: `modal_edit_draft:${draft.id}`,
      user: { id: 'discord-user-1', username: 'TestCreator' },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'draft_content') return 'Edited reply: sure, slot reserved!';
          return '';
        },
      },
      message: { content: sentContent },
      update: async (data: any) => {
        modalUpdatedMessage = data;
      },
    };

    await router(modalInteraction);
    const editedDraft = await getDraftById(draft.id);
    expect(editedDraft?.status).toBe('pending_approval');
    expect(editedDraft?.content).toBe('Edited reply: sure, slot reserved!');
    expect(modalUpdatedMessage?.content).toContain('Edited reply: sure, slot reserved!');
    expect(modalUpdatedMessage?.components).toBeDefined();

    // 6. Test reject button interaction through bot routing
    let rejectUpdatedMessage: any = null;
    const rejectInteraction: any = {
      isButton: () => true,
      isChatInputCommand: () => false,
      isModalSubmit: () => false,
      customId: `reject_draft:${draft.id}`,
      user: { id: 'discord-user-1', username: 'TestCreator' },
      message: { content: modalUpdatedMessage?.content ?? sentContent },
      update: async (data: any) => {
        rejectUpdatedMessage = data;
      },
    };

    await router(rejectInteraction);
    const rejectedDraft = await getDraftById(draft.id);
    expect(rejectedDraft?.status).toBe('rejected');
    expect(rejectUpdatedMessage?.content).toContain('❌ Rejected by TestCreator');
  });
});
