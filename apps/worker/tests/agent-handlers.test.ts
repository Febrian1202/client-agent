import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { inArray } from 'drizzle-orm';
import {
  db,
  agentTasks,
  agentRuns,
  clients,
  conversations,
  drafts,
  messages,
  createTask,
  getOwnerUserId,
  getTaskById,
  upsertClient,
  upsertConversation,
  insertMessagesIfNew,
  getAgentRunsByTaskId,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import type { ParsedTask } from '@client-agent/queue';
import type { OpenAICompatibleClient, ChatCompletionResult } from '@client-agent/ai';
import type { DiscordMessenger } from '@client-agent/discord';
import { handleGenerateSummary } from '../src/handlers/generateSummary';
import { handleGenerateReplyDraft } from '../src/handlers/generateReplyDraft';

const ownerId = await getOwnerUserId();
const runTag = `agent-h-${Date.now()}`;
let seq = 0;

const createdTaskIds: number[] = [];
const createdClientIds: number[] = [];
const createdConversationIds: number[] = [];

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, createdConversationIds));
    await db.delete(drafts).where(inArray(drafts.conversationId, createdConversationIds));
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

function makeMockAiClient(content: string): OpenAICompatibleClient {
  return {
    createChatCompletion: async () => {
      const result: ChatCompletionResult = {
        content,
        finishReason: 'stop',
        model: 'custom-combo-v1',
        usage: { promptTokens: 110, completionTokens: 35, totalTokens: 145 },
        durationMs: 450,
      };
      return result;
    },
  } as unknown as OpenAICompatibleClient;
}

function makeMockMessenger(): { messenger: DiscordMessenger; sentMessages: string[] } {
  const sentMessages: string[] = [];
  return {
    messenger: {
      editInteractionFollowup: async (input) => {
        sentMessages.push(input.content);
        return { messageId: 'm-followup' };
      },
      sendChannelMessage: async (channelId, content) => {
        sentMessages.push(content);
        return { messageId: 'm-channel' };
      },
    },
    sentMessages,
  };
}

describe('Worker Agent Handlers', () => {
  let testClientUsername: string;
  let testConvId: number;

  beforeAll(async () => {
    testClientUsername = `client_${Date.now()}`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: testClientUsername,
      displayName: 'Test Client',
    });
    createdClientIds.push(client.id);

    const conv = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `thread_${testClientUsername}`,
    });
    testConvId = conv.id;
    createdConversationIds.push(conv.id);

    await insertMessagesIfNew(conv.id, [
      {
        externalId: `msg-1-${Date.now()}`,
        direction: 'inbound',
        senderType: 'client',
        senderName: testClientUsername,
        content: 'Halo kak, untuk choker dan badannya apa sudah selesai dipisah layernya?',
        sentAt: new Date(),
      },
    ]);
  });

  it('generates summary, records in agent_runs, and delivers to Discord', async () => {
    seq++;
    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_SUMMARY,
      input: {
        clientUsername: testClientUsername,
        requestedBy: 'discord',
        discord: {
          interactionToken: 'tok-summary',
          applicationId: 'app-1',
          channelId: 'chan-1',
        },
      },
      idempotencyKey: `${runTag}-${seq}`,
    });
    createdTaskIds.push(task.id);

    const summaryText = '1. Status: WIP\n2. Key Details: Client asked about choker & body separation\n3. Next Action: Inform client files are updated';
    const mockAi = makeMockAiClient(summaryText);
    const mockMessenger = makeMockMessenger();

    const parsedTask: ParsedTask = {
      id: 'stream-msg-1',
      data: {
        type: String(TaskType.GENERATE_SUMMARY),
        taskId: String(task.id),
      },
    };

    await handleGenerateSummary(parsedTask, {
      aiClient: mockAi,
      messenger: mockMessenger.messenger,
    });

    const refreshed = await getTaskById(task.id);
    expect(refreshed?.status).toBe(TaskStatus.COMPLETED);

    // Verify agent_runs insertion
    const runs = await getAgentRunsByTaskId(task.id);
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe('success');
    expect(runs[0]!.totalTokens).toBe(145);

    // Verify Discord message delivery
    expect(mockMessenger.sentMessages.length).toBe(1);
    expect(mockMessenger.sentMessages[0]!).toContain('Conversation Summary');
    expect(mockMessenger.sentMessages[0]!).toContain('Client asked about choker & body separation');
  });

  it('generates reply draft, records in agent_runs, and delivers to Discord', async () => {
    seq++;
    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: testClientUsername,
        instruction: 'Katakan choker sudah beres dan file di Drive sudah diupdate',
        requestedBy: 'discord',
        discord: {
          interactionToken: 'tok-reply',
          applicationId: 'app-1',
          channelId: 'chan-1',
        },
      },
      idempotencyKey: `${runTag}-${seq}`,
    });
    createdTaskIds.push(task.id);

    const draftText = 'Halo! Revisi choker dan badannya sudah beres ya, file di Google Drive sudah ku-update.';
    const mockAi = makeMockAiClient(draftText);
    const mockMessenger = makeMockMessenger();

    const parsedTask: ParsedTask = {
      id: 'stream-msg-2',
      data: {
        type: String(TaskType.GENERATE_REPLY_DRAFT),
        taskId: String(task.id),
      },
    };

    await handleGenerateReplyDraft(parsedTask, {
      aiClient: mockAi,
      messenger: mockMessenger.messenger,
    });

    const refreshed = await getTaskById(task.id);
    expect(refreshed?.status).toBe(TaskStatus.COMPLETED);

    // Verify agent_runs insertion
    const runs = await getAgentRunsByTaskId(task.id);
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe('success');

    // Verify Discord message delivery
    expect(mockMessenger.sentMessages.length).toBe(1);
    expect(mockMessenger.sentMessages[0]!).toContain('Draft Reply');
    expect(mockMessenger.sentMessages[0]!).toContain('Draft only — human approval required');
    expect(mockMessenger.sentMessages[0]!).toContain(draftText);
  });

  it('clamps generated reply draft delivered to Discord to max 2000 characters', async () => {
    seq++;
    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: testClientUsername,
        instruction: 'Generate very long detailed breakdown',
        requestedBy: 'discord',
        discord: {
          interactionToken: 'tok-reply-overflow',
          applicationId: 'app-1',
          channelId: 'chan-1',
        },
      },
      idempotencyKey: `${runTag}-${seq}`,
    });
    createdTaskIds.push(task.id);

    const veryLongDraftText = 'Z'.repeat(2500);
    const mockAi = makeMockAiClient(veryLongDraftText);
    const mockMessenger = makeMockMessenger();

    const parsedTask: ParsedTask = {
      id: 'stream-msg-overflow',
      data: {
        type: String(TaskType.GENERATE_REPLY_DRAFT),
        taskId: String(task.id),
      },
    };

    await handleGenerateReplyDraft(parsedTask, {
      aiClient: mockAi,
      messenger: mockMessenger.messenger,
    });

    const refreshed = await getTaskById(task.id);
    expect(refreshed?.status).toBe(TaskStatus.COMPLETED);

    expect(mockMessenger.sentMessages.length).toBe(1);
    expect(mockMessenger.sentMessages[0]!.length).toBeLessThanOrEqual(2000);
    expect(mockMessenger.sentMessages[0]!.endsWith('...')).toBe(true);
  });

  it('passes image attachments from message metadata to multimodal AI prompt in generateSummary', async () => {
    seq++;
    const mediaClientUsername = `client_media_${Date.now()}`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: mediaClientUsername,
    });
    createdClientIds.push(client.id);

    const conv = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `thread_${mediaClientUsername}`,
    });
    createdConversationIds.push(conv.id);

    await insertMessagesIfNew(conv.id, [
      {
        externalId: `msg-media-${Date.now()}`,
        direction: 'inbound',
        senderType: 'client',
        senderName: mediaClientUsername,
        content: 'Halo kak, ini referensi model karakternya:\n[Attached image: model_ref.png]',
        sentAt: new Date(),
        metadata: {
          attachments: [
            {
              type: 'image',
              url: 'https://vgen.co/media/model_ref.png',
              name: 'model_ref.png',
            },
          ],
        },
      },
    ]);

    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_SUMMARY,
      input: {
        clientUsername: mediaClientUsername,
        requestedBy: 'api',
      },
      idempotencyKey: `${runTag}-${seq}`,
    });
    createdTaskIds.push(task.id);

    let passedMessages: any[] = [];
    const mockAi = {
      createChatCompletion: async (opts: any) => {
        passedMessages = opts.messages;
        return {
          content: '1. Status: Initial Inquiry\n2. Key Details: Character reference attached\n3. Next Action: Clarify requirements',
          finishReason: 'stop',
          model: 'gemini_flash',
          usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 },
          durationMs: 300,
        };
      },
    } as unknown as OpenAICompatibleClient;

    const parsedTask: ParsedTask = {
      id: 'stream-msg-media',
      data: {
        type: String(TaskType.GENERATE_SUMMARY),
        taskId: String(task.id),
      },
    };

    await handleGenerateSummary(parsedTask, {
      aiClient: mockAi,
    });

    const refreshed = await getTaskById(task.id);
    expect(refreshed?.status).toBe(TaskStatus.COMPLETED);

    // Verify passed prompt contained image_url
    expect(passedMessages.length).toBe(2);
    expect(Array.isArray(passedMessages[1].content)).toBeTrue();
    const parts = passedMessages[1].content;
    const imgPart = parts.find((p: any) => p.type === 'image_url');
    expect(imgPart).toBeDefined();
    expect(imgPart.image_url.url).toBe('https://vgen.co/media/model_ref.png');
  });
});
