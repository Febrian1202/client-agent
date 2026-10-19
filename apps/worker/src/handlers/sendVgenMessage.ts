import {
  getApprovalsByDraftId,
  getConversationWithClient,
  getDraftById,
  getMessagesByConversationId,
  insertAuditLog,
  insertMessagesIfNew,
  markTaskCompleted,
  markTaskDead,
  updateDraft,
} from '@client-agent/db';
import { AuditAction, DraftStatus } from '@client-agent/domain';
import { verifyPreSendConditions } from '@client-agent/domain';
import { NonRetriableError, type ParsedTask } from '@client-agent/queue';
import { SendAmbiguousError } from '@client-agent/vgen';
import type { DiscordMessenger } from '@client-agent/discord';
import { resolveVgenWorkerDeps } from '../services/vgen';
import { resolveDiscordNotifier } from '../services/discord';

export interface SendVgenAdapter {
  getAuthenticatedUsername(): Promise<string | null>;
  sendMessage(input: {
    conversationId: string;
    content: string;
    conversationUrl?: string;
    clientUsername?: string;
  }): Promise<{ success: boolean; messageId: string }>;
}

export interface SendVgenMessageDeps {
  adapter?: SendVgenAdapter;
  messenger?: DiscordMessenger | null;
  channelId?: string;
  getDraft?: (id: number) => Promise<any>;
  getConversation?: (id: number) => Promise<any>;
  getClient?: (id: number) => Promise<any>;
  getApprovals?: (draftId: number) => Promise<any[]>;
  getLatestInboundMessage?: (conversationId: number) => Promise<any>;
  getCreatorUsername?: () => string;
  insertAuditLog?: (log: any) => Promise<any>;
  markTaskDead?: (taskId: number, error: string) => Promise<any>;
  markTaskCompleted?: (taskId: number, output: Record<string, unknown>) => Promise<any>;
  updateDraft?: (id: number, data: any) => Promise<any>;
  insertMessage?: (conversationId: number, data: any) => Promise<any>;
  getDiscordChannelId?: () => Promise<string | null>;
  computeHash?: (content: string) => string;
}

export async function handleSendVgenMessage(
  task: ParsedTask,
  deps?: SendVgenMessageDeps,
): Promise<void> {
  const taskId = Number(task.data.taskId);
  const draftId = Number(task.data.draftId);

  if (Number.isNaN(taskId) || Number.isNaN(draftId)) {
    throw new NonRetriableError('Task missing valid taskId or draftId');
  }

  const insertAuditLogFn = deps?.insertAuditLog ?? insertAuditLog;
  const markTaskDeadFn = deps?.markTaskDead ?? markTaskDead;
  const markTaskCompletedFn = deps?.markTaskCompleted ?? markTaskCompleted;
  const updateDraftFn = deps?.updateDraft ?? updateDraft;

  let adapter = deps?.adapter;
  let messenger = deps?.messenger;
  if (!adapter) {
    const vgenDeps = await resolveVgenWorkerDeps();
    adapter = vgenDeps.adapter;
    messenger ??= vgenDeps.messenger;
  }

  const draft = deps?.getDraft ? await deps.getDraft(draftId) : await getDraftById(draftId);

  let conv: any = null;
  let client: any = null;

  if (deps?.getConversation) {
    conv = await deps.getConversation(draft?.conversationId ?? 0);
  }
  if (deps?.getClient) {
    client = await deps.getClient(conv?.clientId ?? 0);
  }
  if (!conv || !client) {
    if (draft?.conversationId) {
      const convWithClient = await getConversationWithClient(draft.conversationId);
      if (convWithClient) {
        conv ??= convWithClient.conversation;
        client ??= { id: convWithClient.clientId, username: convWithClient.clientUsername };
      }
    }
  }

  const approvals = deps?.getApprovals
    ? await deps.getApprovals(draftId)
    : await getApprovalsByDraftId(draftId);
  const activeApproval =
    approvals.find((a: any) => a.status === 'active' && a.action === 'approve') ??
    approvals.find((a: any) => a.status === 'active') ??
    null;

  let latestInboundMessage: any = null;
  if (deps?.getLatestInboundMessage) {
    latestInboundMessage = await deps.getLatestInboundMessage(conv?.id ?? 0);
  } else if (conv?.id) {
    const msgs = await getMessagesByConversationId(conv.id, 50);
    const inbound = msgs.filter((m) => m.direction === 'inbound');
    latestInboundMessage = inbound.length > 0 ? inbound[inbound.length - 1] : null;
  }

  const creatorUsername = deps?.getCreatorUsername
    ? deps.getCreatorUsername()
    : (process.env.VGEN_CREATOR_USERNAME || 'r1daz_');

  let authenticatedCreatorUsername: string | null = null;
  try {
    authenticatedCreatorUsername = await adapter.getAuthenticatedUsername();
  } catch {
    authenticatedCreatorUsername = null;
  }

  const sendDiscordNotification = async (text: string) => {
    if (!messenger) return;
    try {
      let channelId = deps?.channelId;
      if (!channelId && deps?.getDiscordChannelId) {
        channelId = (await deps.getDiscordChannelId()) ?? undefined;
      }
      if (!channelId) {
        const notifDeps = await resolveDiscordNotifier();
        channelId = notifDeps?.channelId;
      }
      channelId ??= 'default';
      await messenger.sendChannelMessage(channelId, text);
    } catch (e) {
      console.error('[sendVgenMessage] Failed to send Discord notification:', e);
    }
  };

  const safety = verifyPreSendConditions({
    draft: draft as any,
    conversation: conv as any,
    client: client as any,
    activeApproval: activeApproval as any,
    expectedCreatorUsername: creatorUsername,
    authenticatedCreatorUsername,
    latestInboundMessageSentAt: latestInboundMessage?.sentAt ? new Date(latestInboundMessage.sentAt) : null,
    computeHash: deps?.computeHash,
  });

  if (!safety.allowed) {
    const reason = safety.reason ?? 'Pre-send safety gate check failed';
    await insertAuditLogFn({
      actorType: 'agent',
      action: AuditAction.MESSAGE_SEND_ABORTED_SAFETY_CHECK,
      targetType: 'draft',
      targetId: draftId,
      metadata: { reason, failedCheck: safety.failedCheck },
    });
    await markTaskDeadFn(taskId, reason);
    await sendDiscordNotification(`🛑 Safety check blocked send: ${reason}`);
    throw new NonRetriableError(reason);
  }

  await insertAuditLogFn({
    actorType: 'agent',
    action: AuditAction.AGENT_ATTEMPTED_SEND,
    targetType: 'draft',
    targetId: draftId,
    metadata: {
      conversationId: conv.id,
      clientId: client.id,
      clientUsername: client.username,
    },
  });

  let result: { success: boolean; messageId: string };
  try {
    result = await adapter.sendMessage({
      conversationId: String(conv.id),
      content: draft.content,
      conversationUrl: conv.externalUrl,
      clientUsername: client.username,
    });
  } catch (err) {
    if (err instanceof SendAmbiguousError) {
      await insertAuditLogFn({
        actorType: 'agent',
        action: AuditAction.MESSAGE_SEND_FAILED,
        targetType: 'draft',
        targetId: draftId,
        metadata: { ambiguous: true, error: err.message },
      });
      await markTaskDeadFn(taskId, `Ambiguous send: ${err.message}`);
      await sendDiscordNotification(
        `⚠️ Message send to @${client.username} is AMBIGUOUS. Please inspect VGen manually before retrying!`,
      );
      throw new NonRetriableError(err.message);
    }
    throw err;
  }

  const now = new Date();
  if (deps?.insertMessage) {
    await deps.insertMessage(conv.id, {
      externalId: result.messageId,
      direction: 'outbound',
      senderType: 'creator',
      senderName: creatorUsername,
      content: draft.content,
      sentAt: now,
    });
  } else {
    await insertMessagesIfNew(conv.id, [
      {
        externalId: result.messageId,
        direction: 'outbound',
        senderType: 'creator',
        senderName: creatorUsername,
        content: draft.content,
        sentAt: now,
      },
    ]);
  }

  await updateDraftFn(draftId, {
    status: DraftStatus.SENT,
    sentAt: now,
  });

  await insertAuditLogFn({
    actorType: 'agent',
    action: AuditAction.MESSAGE_SENT,
    targetType: 'draft',
    targetId: draftId,
    metadata: {
      conversationId: conv.id,
      clientId: client.id,
      messageId: result.messageId,
    },
  });

  await sendDiscordNotification(`🚀 Message successfully delivered to @${client.username} on VGen!`);

  await markTaskCompletedFn(taskId, { success: true, messageId: result.messageId });
}
