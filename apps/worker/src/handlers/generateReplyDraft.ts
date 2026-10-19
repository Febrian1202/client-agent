import {
  getClientByUsername,
  getConversationByClientId,
  getMessagesByConversationId,
  getOwnerUserId,
  getTaskById,
  insertAgentRun,
  insertAuditLog,
  insertDraft,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  upsertClient,
  upsertConversation,
} from '@client-agent/db';
import { AuditAction, DraftStatus, TaskStatus } from '@client-agent/domain';
import type { ParsedTask } from '@client-agent/queue';
import type { OpenAICompatibleClient } from '@client-agent/ai';
import {
  buildDraftActionRow,
  formatReplyDraftMessage,
  type DiscordMessenger,
} from '@client-agent/discord';
import {
  buildReplyPrompt,
  type ConversationContextForPrompt,
  type PromptMessageHistory,
} from '@client-agent/agent';

export interface GenerateReplyDraftTaskInput {
  clientUsername: string;
  instruction: string;
  tone?: string;
  requestedBy?: 'discord' | 'api' | 'web';
  discord?: {
    interactionId?: string;
    interactionToken?: string;
    applicationId?: string;
    channelId?: string;
  };
}

export interface GenerateReplyDraftDeps {
  aiClient: OpenAICompatibleClient;
  messenger?: DiscordMessenger | null;
}

export async function handleGenerateReplyDraft(
  task: ParsedTask,
  deps: GenerateReplyDraftDeps,
): Promise<void> {
  const taskId = Number(task.data.taskId);
  const row = await getTaskById(taskId);
  if (!row) {
    throw new Error(`Task ${taskId} not found`);
  }
  if (row.status === TaskStatus.COMPLETED) {
    return;
  }

  const input = (row.input ?? {}) as unknown as GenerateReplyDraftTaskInput;
  if (!input.clientUsername || !input.instruction) {
    throw new Error('GenerateReplyDraftTaskInput missing clientUsername or instruction');
  }

  await markTaskRunning(taskId);

  const startTime = Date.now();
  try {
    const ownerId = await getOwnerUserId();
    let client = await getClientByUsername(ownerId, 'vgen', input.clientUsername);

    let messagesList: PromptMessageHistory[] = [];
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
    }

    const context: ConversationContextForPrompt = {
      clientUsername: input.clientUsername,
      clientDisplayName: client?.displayName ?? undefined,
      creatorUsername: 'r1daz_',
      messages: messagesList,
    };

    const promptMessages = buildReplyPrompt(context, input.instruction, input.tone);
    const aiResult = await deps.aiClient.createChatCompletion({
      messages: promptMessages,
      temperature: 0.5,
    });

    const content = aiResult.content ?? '(No draft reply generated)';

    const agentRun = await insertAgentRun({
      taskId,
      provider: 'openai-compatible',
      model: aiResult.model,
      systemVersion: 'v1.0',
      input: { messages: promptMessages, instruction: input.instruction },
      output: { content: aiResult.content, finishReason: aiResult.finishReason },
      promptTokens: aiResult.usage.promptTokens,
      completionTokens: aiResult.usage.completionTokens,
      totalTokens: aiResult.usage.totalTokens,
      durationMs: aiResult.durationMs,
      status: 'success',
    });

    if (!client) {
      client = await upsertClient({
        userId: ownerId,
        platform: 'vgen',
        username: input.clientUsername,
      });
    }

    let conv = await getConversationByClientId(client.id);
    if (!conv) {
      conv = await upsertConversation({
        clientId: client.id,
        platform: 'vgen',
        externalId: `vgen_${client.username}`,
      });
    }

    const draft = await insertDraft({
      conversationId: conv.id,
      agentRunId: agentRun.id,
      content,
      status: DraftStatus.PENDING_APPROVAL,
    });

    await insertAuditLog({
      userId: ownerId,
      actorType: 'agent',
      actorId: agentRun.id,
      action: AuditAction.AGENT_GENERATED_DRAFT,
      targetType: 'draft',
      targetId: draft.id,
      metadata: { taskId, conversationId: conv.id, agentRunId: agentRun.id },
    });

    let formatted = formatReplyDraftMessage(input.clientUsername, content);
    if (formatted.length > 2000) {
      formatted = formatted.slice(0, 1997) + '...';
    }
    const actionRow = buildDraftActionRow(draft.id);

    if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
      try {
        await deps.messenger.editInteractionFollowup({
          applicationId: input.discord.applicationId,
          interactionToken: input.discord.interactionToken,
          content: formatted,
          components: [actionRow],
        });
      } catch (err) {
        console.error('[worker:reply] Failed to edit interaction followup:', err);
      }
    } else if (deps.messenger && input.discord?.channelId) {
      try {
        await deps.messenger.sendChannelMessage(input.discord.channelId, formatted, {
          components: [actionRow],
        });
      } catch (err) {
        console.error('[worker:reply] Failed to send channel message:', err);
      }
    }

    await markTaskCompleted(taskId, {
      draft: content,
      draftId: draft.id,
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
      input: { clientUsername: input.clientUsername, instruction: input.instruction },
      output: {},
      durationMs,
      status: 'error',
      errorMessage: err.message || 'Unknown error during reply draft generation',
    });

    if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
      try {
        await deps.messenger.editInteractionFollowup({
          applicationId: input.discord.applicationId,
          interactionToken: input.discord.interactionToken,
          content: `❌ Failed to generate reply draft: ${err.message || err}`,
        });
      } catch {}
    }

    await markTaskFailed(taskId, err.message || 'Reply draft generation failed');
    throw err;
  }
}
