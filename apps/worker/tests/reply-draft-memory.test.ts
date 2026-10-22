import { describe, expect, it } from 'bun:test';
import { handleGenerateReplyDraft } from '../src/handlers/generateReplyDraft';
import {
  db,
  getOwnerUserId,
  insertClient,
  insertClientMemory,
  insertConversation,
  createTask,
  getTaskById,
  agentTasks,
  agentRuns,
  clients,
  conversations,
  drafts,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { eq } from 'drizzle-orm';

describe('Worker Reply Draft with Client Memory', () => {
  const suffix = Date.now();
  let ownerId: number;
  let client: any;
  let conv: any;

  it('loads client memories and includes them in AI chat completion prompt', async () => {
    ownerId = await getOwnerUserId();
    client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `mem_worker_${suffix}`,
    });
    conv = await insertConversation({
      userId: ownerId,
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_${suffix}`,
      externalThreadId: `thread_${suffix}`,
    });

    await insertClientMemory({
      clientId: client.id,
      type: 'fact',
      category: 'technical',
      content: 'Uses VTube Studio iOS tracking',
    });

    const taskRow = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: client.username,
        instruction: 'Confirm file receipt',
      },
    });

    let sentMessages: any[] = [];
    const mockAiClient = {
      async createChatCompletion(params: any) {
        sentMessages = params.messages;
        return {
          content: 'Confirmed, got your files! Setting up for VTube Studio iOS tracking.',
          model: 'gpt-4o',
          finishReason: 'stop',
          durationMs: 120,
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        };
      },
    };

    await handleGenerateReplyDraft(
      { id: '1', data: { taskId: String(taskRow.id) } },
      { aiClient: mockAiClient as any }
    );

    const updatedTask = await getTaskById(taskRow.id);
    expect(updatedTask?.status).toBe(TaskStatus.COMPLETED);

    const userPrompt = sentMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('Uses VTube Studio iOS tracking');

    // Clean up
    await db.delete(drafts).where(eq(drafts.conversationId, conv.id));
    await db.delete(conversations).where(eq(conversations.id, conv.id));
    await db.delete(clients).where(eq(clients.id, client.id));
    await db.delete(agentRuns).where(eq(agentRuns.taskId, taskRow.id));
    await db.delete(agentTasks).where(eq(agentTasks.id, taskRow.id));
  });
});
