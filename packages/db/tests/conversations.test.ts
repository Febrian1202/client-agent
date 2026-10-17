import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db, getOwnerUserId,
  conversations, messages, auditLogs, clients,
} from '../src/index';

const suffix = Date.now();
const username = `ConvUser${suffix}`;
const platformExternalId = `thread-${suffix}`;
const messageSuffix = `msg-${suffix}`;

let clientId = 0;
let conversationId = 0;

beforeAll(async () => {
  const userId = await getOwnerUserId();
  const [client] = await db.insert(clients)
    .values({ userId, platform: 'vgen', username })
    .returning({ id: clients.id });
  clientId = client!.id;
});

afterAll(async () => {
  if (conversationId) await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.externalId, platformExternalId));
  await db.delete(clients).where(eq(clients.username, username));
});

describe('Phase 3 schema: conversations, messages, audit_logs', () => {
  it('inserts a conversation with defaults and null lastSyncedAt', async () => {
    const [row] = await db.insert(conversations)
      .values({ clientId, platform: 'vgen', externalId: platformExternalId, externalUrl: 'https://vgen.co/inbox/thread-1' })
      .returning();
    conversationId = row!.id;
    expect(row!.status).toBe('active');
    expect(row!.lastSyncedAt).toBeNull();
  });

  it('rejects a duplicate (platform, externalId) conversation', async () => {
    let error: unknown;
    try {
      await db.insert(conversations)
        .values({ clientId, platform: 'vgen', externalId: platformExternalId });
    } catch (e) {
      error = e;
    }
    expect((error as { code?: string }).code).toBe('23505');
  });

  it('inserts a message and rejects a duplicate (conversationId, externalId)', async () => {
    const [row] = await db.insert(messages)
      .values({
        conversationId, externalId: messageSuffix, direction: 'inbound',
        senderType: 'client', senderName: 'ErianOsamu', content: 'Hello!', sentAt: new Date(),
      })
      .returning();
    expect(row!.content).toBe('Hello!');

    let error: unknown;
    try {
      await db.insert(messages)
        .values({
          conversationId, externalId: messageSuffix, direction: 'inbound',
          senderType: 'client', senderName: 'ErianOsamu', content: 'Hello!', sentAt: new Date(),
        });
    } catch (e) {
      error = e;
    }
    expect((error as { code?: string }).code).toBe('23505');
  });

  it('inserts an auditLog without an updatedAt column', async () => {
    const userId = await getOwnerUserId();
    const [row] = await db.insert(auditLogs)
      .values({
        userId, actorType: 'agent', action: 'AGENT_READ_CONVERSATION',
        targetType: 'conversation', targetId: conversationId,
      })
      .returning();
    expect(row!.action).toBe('AGENT_READ_CONVERSATION');
    expect(row!).not.toHaveProperty('updatedAt');
  });
});
