import {
  getConversationWithClient,
  getOwnerUserId,
  getTaskById,
  insertAuditLog,
  insertMessagesIfNew,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  touchConversationLastSynced,
  upsertClient,
  upsertConversation,
} from '@client-agent/db';
import { TaskStatus } from '@client-agent/domain';
import { NonRetriableError, type ParsedTask } from '@client-agent/queue';
import { formatConversationPreview, type DiscordMessenger } from '@client-agent/discord';
import type { ConversationResult, PlatformAdapter } from '@client-agent/platform';
import { ClientNotFoundError, SessionExpiredError } from '@client-agent/vgen';

export interface ReadVgenTaskInput {
  clientUsername: string;
  requestedBy?: 'discord' | 'api' | 'web';
  discord?: {
    interactionId?: string;
    interactionToken?: string;
    applicationId?: string;
    channelId?: string;
  };
}

export type ReadVgenOutput = {
  conversationId: number;
  conversationExternalId: string;
  externalUrl: string;
  clientId: number;
  messagesReceived: number;
  messagesNew: number;
  deliveredVia: 'interaction' | 'channel' | 'none';
  deliveryError?: string;
};

export interface ReadVgenDeps {
  adapter: Pick<PlatformAdapter, 'getConversation'>;
  messenger?: DiscordMessenger | null;
}

const SESSION_EXPIRED_MESSAGE =
  '⚠️ VGen session has expired! Please log in via browser profile to resume automation.';

const EMPTY_READ_OUTPUT: ReadVgenOutput = {
  conversationId: 0,
  conversationExternalId: '',
  externalUrl: '',
  clientId: 0,
  messagesReceived: 0,
  messagesNew: 0,
  deliveredVia: 'none',
};

export async function runConversationRead(
  input: ReadVgenTaskInput,
  taskId: number,
  deps: ReadVgenDeps,
): Promise<ReadVgenOutput> {
  let result: ConversationResult;
  try {
    result = await deps.adapter.getConversation({ clientUsername: input.clientUsername });
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      await insertAuditLog({
        actorType: 'agent',
        action: 'SESSION_EXPIRED',
        targetType: 'task',
        targetId: taskId,
        metadata: { clientUsername: input.clientUsername },
      });
      if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
        try {
          await deps.messenger.editInteractionFollowup({
            applicationId: input.discord.applicationId,
            interactionToken: input.discord.interactionToken,
            content: SESSION_EXPIRED_MESSAGE,
          });
        } catch {}
      } else if (deps.messenger && input.discord?.channelId) {
        try {
          await deps.messenger.sendChannelMessage(input.discord.channelId, SESSION_EXPIRED_MESSAGE);
        } catch {
          // best-effort alert; the NonRetriableError below still fails the task
        }
      }
      throw new NonRetriableError('VGen session expired — awaiting manual re-auth');
    }
    if (err instanceof ClientNotFoundError) {
      const notFoundMessage = `⚠️ Client @${input.clientUsername} was not found on VGen.`;
      if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
        try {
          await deps.messenger.editInteractionFollowup({
            applicationId: input.discord.applicationId,
            interactionToken: input.discord.interactionToken,
            content: notFoundMessage,
          });
        } catch {}
      } else if (deps.messenger && input.discord?.channelId) {
        try {
          await deps.messenger.sendChannelMessage(input.discord.channelId, notFoundMessage);
        } catch {}
      }
      throw new NonRetriableError(err.message);
    }
    if (deps.messenger && input.discord?.interactionToken && input.discord?.applicationId) {
      try {
        await deps.messenger.editInteractionFollowup({
          applicationId: input.discord.applicationId,
          interactionToken: input.discord.interactionToken,
          content: `⚠️ Error fetching conversation for @${input.clientUsername}: ${err instanceof Error ? err.message : String(err)}`,
        });
      } catch {}
    }
    throw err;
  }

  const ownerId = await getOwnerUserId();
  const client = await upsertClient({
    userId: ownerId,
    platform: 'vgen',
    username: input.clientUsername,
  });

  const conversation = await upsertConversation({
    clientId: client.id,
    platform: 'vgen',
    externalId: result.externalId,
    externalUrl: result.externalUrl,
  });

  const messagesNew = await insertMessagesIfNew(
    conversation.id,
    result.messages.map((message) => ({
      externalId: message.externalId,
      direction: message.direction,
      senderType: message.direction === 'inbound' ? 'client' : 'creator',
      senderName: message.senderName,
      content: message.content,
      sentAt: message.sentAt,
      metadata: {
        sentAtRaw: message.sentAtRaw ?? null,
        attachments: message.attachments ?? [],
      },
    })),
  );

  await touchConversationLastSynced(conversation.id);

  await insertAuditLog({
    actorType: 'agent',
    action: 'AGENT_READ_CONVERSATION',
    targetType: 'conversation',
    targetId: conversation.id,
    metadata: { messagesNew, requestedBy: input.requestedBy ?? 'api' },
  });

  const output: ReadVgenOutput = {
    conversationId: conversation.id,
    conversationExternalId: conversation.externalId,
    externalUrl: result.externalUrl,
    clientId: client.id,
    messagesReceived: result.messages.length,
    messagesNew,
    deliveredVia: 'none',
  };

  if (input.requestedBy !== 'discord') {
    return output;
  }

  const discord = input.discord;
  const content = formatConversationPreview(result.clientUsername, result.messages.slice(-5));

  if (deps.messenger && discord?.interactionToken && discord?.applicationId) {
    try {
      await deps.messenger.editInteractionFollowup({
        applicationId: discord.applicationId,
        interactionToken: discord.interactionToken,
        content,
      });
      output.deliveredVia = 'interaction';
    } catch (err) {
      output.deliveredVia = 'interaction';
      output.deliveryError = String(err);
    }
  } else if (deps.messenger && discord?.channelId) {
    try {
      await deps.messenger.sendChannelMessage(discord.channelId, content);
      output.deliveredVia = 'channel';
    } catch (err) {
      output.deliveredVia = 'channel';
      output.deliveryError = String(err);
    }
  }

  return output;
}

export async function handleReadVgenConversation(
  task: ParsedTask,
  deps: ReadVgenDeps,
): Promise<ReadVgenOutput> {
  const taskId = Number(task.data.taskId);
  if (Number.isNaN(taskId)) {
    throw new Error('READ_VGEN_CONVERSATION message missing taskId');
  }

  const taskRow = await getTaskById(taskId);
  if (!taskRow) {
    throw new Error(`READ_VGEN_CONVERSATION task ${taskId} not found`);
  }

  if (taskRow.status === TaskStatus.COMPLETED) {
    return (taskRow.output as ReadVgenOutput | null) ?? { ...EMPTY_READ_OUTPUT };
  }

  const isStandalone = taskRow.status !== TaskStatus.RUNNING;

  try {
    if (isStandalone) {
      await markTaskRunning(taskId);
    }

    const input = (taskRow.input ?? {}) as ReadVgenTaskInput;
    const output = await runConversationRead(input, taskId, deps);

    if (isStandalone) {
      await markTaskCompleted(taskId, { ...output });
    }

    return output;
  } catch (err) {
    if (isStandalone) {
      await markTaskFailed(taskId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

export async function handleSyncConversation(
  task: ParsedTask,
  deps: ReadVgenDeps,
): Promise<ReadVgenOutput> {
  const taskId = Number(task.data.taskId);
  if (Number.isNaN(taskId)) {
    throw new Error('SYNC_CONVERSATION message missing taskId');
  }

  const taskRow = await getTaskById(taskId);
  if (!taskRow) {
    throw new Error(`SYNC_CONVERSATION task ${taskId} not found`);
  }

  if (taskRow.status === TaskStatus.COMPLETED) {
    return (taskRow.output as ReadVgenOutput | null) ?? { ...EMPTY_READ_OUTPUT };
  }

  const isStandalone = taskRow.status !== TaskStatus.RUNNING;

  try {
    if (isStandalone) {
      await markTaskRunning(taskId);
    }

    const syncInput = (taskRow.input ?? {}) as { conversationId?: number | string };
    const rawConversationId = syncInput.conversationId;
    const conversationId =
      typeof rawConversationId === 'number'
        ? rawConversationId
        : typeof rawConversationId === 'string' && rawConversationId.trim() !== ''
          ? Number(rawConversationId)
          : NaN;
    const row =
      Number.isInteger(conversationId) && conversationId > 0
        ? await getConversationWithClient(conversationId)
        : null;
    if (!row) {
      throw new Error('SYNC_CONVERSATION input missing conversation');
    }

    const output = await runConversationRead(
      { clientUsername: row.clientUsername, requestedBy: 'api' },
      taskId,
      deps,
    );

    if (isStandalone) {
      await markTaskCompleted(taskId, { ...output });
    }

    return output;
  } catch (err) {
    if (isStandalone) {
      await markTaskFailed(taskId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}
