import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  db, getOwnerUserId, upsertClient, createTask,
  upsertConversation, findConversationByExternalId, getConversationById,
  touchConversationLastSynced, getConversationWithClient,
  insertMessagesIfNew, insertAuditLog,
  conversations, messages, auditLogs, clients,
  agentTasks,
} from '../src/index';
import { TaskType } from '@client-agent/domain';

const suffix = Date.now();
const username = `QueriesPhase3User${suffix}`;
const mainExternalId = `qc-thread-${suffix}`;
const chunkExternalId = `qc-chunk-${suffix}`;

const messageExternalId = (n: number) => `qc-msg-${suffix}-${n}`;

const sampleMessage = (n: number) => ({
  externalId: messageExternalId(n),
  direction: 'inbound' as const,
  senderType: 'client' as const,
  senderName: 'ErianOsamu',
  content: `Message ${n}`,
  sentAt: new Date(`2026-10-16T14:30:0${n % 10}Z`),
});

let clientId = 0;
let conversationId = 0;
let chunkConversationId = 0;
let taskId = 0;
const taskKey = `queries-phase3:${suffix}`;
const auditLogIds: number[] = [];

beforeAll(async () => {
  const userId = await getOwnerUserId();
  const client = await upsertClient({ userId, platform: 'vgen', username });
  clientId = client.id;
  const task = await createTask({ userId, type: TaskType.PROCESS_GMAIL_EVENT, input: {}, idempotencyKey: taskKey });
  taskId = task.id;
});

afterAll(async () => {
  const conversationIds = [conversationId, chunkConversationId].filter((id) => id > 0);
  if (conversationIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, conversationIds));
  }
  await db.delete(conversations).where(inArray(conversations.externalId, [mainExternalId, chunkExternalId]));
  if (auditLogIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
  }
  await db.delete(agentTasks).where(eq(agentTasks.idempotencyKey, taskKey));
  await db.delete(clients).where(eq(clients.username, username));
});

describe('Phase 3 query helpers', () => {
  it('upserts a conversation in place, updating externalUrl', async () => {
    const first = await upsertConversation({
      clientId, platform: 'vgen', externalId: mainExternalId,
      externalUrl: `https://vgen.co/inbox/${mainExternalId}`,
    });
    const second = await upsertConversation({
      clientId, platform: 'vgen', externalId: mainExternalId,
      externalUrl: `https://vgen.co/inbox/${mainExternalId}-v2`,
    });
    expect(second.id).toBe(first.id);
    expect(second.externalUrl).toBe(`https://vgen.co/inbox/${mainExternalId}-v2`);

    const found = await findConversationByExternalId('vgen', mainExternalId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(first.id);
    conversationId = first.id;
  });

  it('inserts only new messages and dedups the rest', async () => {
    const firstThree = [sampleMessage(1), sampleMessage(2), sampleMessage(3)];
    expect(await insertMessagesIfNew(conversationId, firstThree)).toBe(3);

    const fourth = { ...sampleMessage(4), sentAt: null };
    expect(await insertMessagesIfNew(conversationId, [...firstThree, fourth])).toBe(1);

    const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, conversationId));
    expect(rows.length).toBe(4);
  });

  it('chunks 150 messages and returns 0 on repeat', async () => {
    const chunkConversation = await upsertConversation({
      clientId, platform: 'vgen', externalId: chunkExternalId,
    });
    chunkConversationId = chunkConversation.id;

    const batch = Array.from({ length: 150 }, (_, i) => sampleMessage(1000 + i));
    expect(await insertMessagesIfNew(chunkConversationId, batch)).toBe(150);
    expect(await insertMessagesIfNew(chunkConversationId, batch)).toBe(0);
  });

  it('touches lastSyncedAt on the conversation', async () => {
    await touchConversationLastSynced(conversationId);
    const row = await getConversationById(conversationId);
    expect(row).not.toBeNull();
    expect(row!.lastSyncedAt).not.toBeNull();
  });

  it('joins the client username, null for a missing conversation', async () => {
    const joined = await getConversationWithClient(conversationId);
    expect(joined).not.toBeNull();
    expect(joined!.clientUsername).toBe(username);
    expect(joined!.clientId).toBe(clientId);
    expect(joined!.conversation.id).toBe(conversationId);

    const missing = await getConversationWithClient(9999999);
    expect(missing).toBeNull();
  });

  it('writes and reads back an agent audit log', async () => {
    const row = await insertAuditLog({
      actorType: 'agent', action: 'SESSION_EXPIRED',
      targetType: 'task', targetId: taskId,
      metadata: { reason: 'vgen session expired' },
    });
    auditLogIds.push(row.id);
    expect(row.action).toBe('SESSION_EXPIRED');
    expect(row.actorType).toBe('agent');

    const readBack = await db.select().from(auditLogs).where(eq(auditLogs.id, row.id)).limit(1);
    expect(readBack[0]!.metadata).toEqual({ reason: 'vgen session expired' });
  });
});
