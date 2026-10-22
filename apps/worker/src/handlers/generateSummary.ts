import {
  getClientByUsername,
  getConversationByClientId,
  getMessagesByConversationId,
  getOwnerUserId,
  getTaskById,
  insertAgentRun,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  listClientMemories,
} from '@client-agent/db';
import { TaskStatus } from '@client-agent/domain';
import type { ParsedTask } from '@client-agent/queue';
import type { OpenAICompatibleClient } from '@client-agent/ai';
import { formatSummaryMessage, type DiscordMessenger } from '@client-agent/discord';
import {
  buildSummaryPrompt,
  type ConversationContextForPrompt,
  type PromptMessageHistory,
} from '@client-agent/agent';

export interface GenerateSummaryTaskInput {
  clientUsername: string;
  requestedBy?: 'discord' | 'api' | 'web';
  discord?: {
    interactionId?: string;
    interactionToken?: string;
    applicationId?: string;
    channelId?: string;
  };
}

export interface GenerateSummaryDeps {
  aiClient: OpenAICompatibleClient;
  messenger?: DiscordMessenger | null;
}

export async function handleGenerateSummary(
  task: ParsedTask,
  deps: GenerateSummaryDeps,
): Promise<void> {
  const taskId = Number(task.data.taskId);
  const row = await getTaskById(taskId);
  if (!row) {
    throw new Error(`Task ${taskId} not found`);
  }
  if (row.status === TaskStatus.COMPLETED) {
    return;
  }

  const input = (row.input ?? {}) as unknown as GenerateSummaryTaskInput;
  if (!input.clientUsername) {
    throw new Error('GenerateSummaryTaskInput missing clientUsername');
  }

  await markTaskRunning(taskId);

  const startTime = Date.now();
  try {
    const ownerId = await getOwnerUserId();
    const client = await getClientByUsername(ownerId, 'vgen', input.clientUsername);

    let messagesList: PromptMessageHistory[] = [];
    let memoryList: { type: string; category: string; content: string }[] = [];

    if (client) {
      const conv = await getConversationByClientId(client.id);
      if (conv) {
        const storedMessages = await getMessagesByConversationId(conv.id, 30);
        messagesList = storedMessages.map((m) => ({
          direction: m.direction as 'inbound' | 'outbound',
          senderName: m.senderName,
          content: m.content,
          sentAt: m.sentAt ?? new Date(),
        }));
      }

      const clientMems = await listClientMemories(client.id);
      memoryList = clientMems.map((m) => ({
        type: m.type,
        category: m.category,
        content: m.content,
      }));
    }

    const context: ConversationContextForPrompt = {
      clientUsername: input.clientUsername,
      clientDisplayName: client?.displayName ?? undefined,
      creatorUsername: 'r1daz_',
      messages: messagesList,
      memories: memoryList,
    };

    const promptMessages = buildSummaryPrompt(context);
    const aiResult = await deps.aiClient.createChatCompletion({
      messages: promptMessages,
      temperature: 0.3,
    });

    const content = aiResult.content ?? '(No summary generated)';

    await insertAgentRun({
      taskId,
      provider: 'openai-compatible',
      model: aiResult.model,
      systemVersion: 'v1.0',
      input: { messages: promptMessages },
      output: { content: aiResult.content, finishReason: aiResult.finishReason },
      promptTokens: aiResult.usage.promptTokens,
      completionTokens: aiResult.usage.completionTokens,
      totalTokens: aiResult.usage.totalTokens,
      durationMs: aiResult.durationMs,
      status: 'success',
    });

    const formatted = formatSummaryMessage(input.clientUsername, content);

    if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
      try {
        await deps.messenger.editInteractionFollowup({
          applicationId: input.discord.applicationId,
          interactionToken: input.discord.interactionToken,
          content: formatted,
        });
      } catch (err) {
        console.error('[worker:summary] Failed to edit interaction followup:', err);
      }
    } else if (deps.messenger && input.discord?.channelId) {
      try {
        await deps.messenger.sendChannelMessage(input.discord.channelId, formatted);
      } catch (err) {
        console.error('[worker:summary] Failed to send channel message:', err);
      }
    }

    await markTaskCompleted(taskId, {
      summary: content,
      totalTokens: aiResult.usage.totalTokens,
      durationMs: aiResult.durationMs,
    });
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    await insertAgentRun({
      taskId,
      provider: 'openai-compatible',
      model: 'unknown',
      systemVersion: 'v1.0',
      input: { clientUsername: input.clientUsername },
      output: {},
      durationMs,
      status: 'error',
      errorMessage: err.message || 'Unknown error during summary generation',
    });

    if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
      try {
        await deps.messenger.editInteractionFollowup({
          applicationId: input.discord.applicationId,
          interactionToken: input.discord.interactionToken,
          content: `❌ Failed to generate summary: ${err.message || err}`,
        });
      } catch {}
    }

    await markTaskFailed(taskId, err.message || 'Summary generation failed');
    throw err;
  }
}
