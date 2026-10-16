import { describe, expect, it, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import {
  db, events, agentTasks, clients, getOwnerUserId, upsertIntegration, deleteIntegration,
} from '@client-agent/db';
import { STREAMS, createRedisClient } from '@client-agent/queue';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { type DiscordNotifier } from '@client-agent/discord';
import { createGmailWebhookRoutes } from '../apps/api/src/routes/webhooks/gmail';
import { handleProcessGmailEvent } from '../apps/worker/src/handlers/processGmailEvent';
import { handleNotifyDiscord } from '../apps/worker/src/handlers/notifyDiscord';

const ownerId = await getOwnerUserId();
const suffix = Date.now();
const externalId = `e2e-${suffix}`;
const username = `E2EUser${suffix}`;
const historyId = '9000';
const notificationsStream = `${STREAMS.NOTIFICATIONS}_e2e_${suffix}`;
const redis = createRedisClient();
const createdTaskIds: number[] = [];

// Reads a Redis stream field list into a plain record so assertions do not depend on key order.
function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) record[fields[i]!] = fields[i + 1]!;
  return record;
}

const push = () => ({
  message: { data: Buffer.from(JSON.stringify({ emailAddress: 'me@example.com', historyId })).toString('base64') },
});

const gmail = {
  getProfile: async () => ({ emailAddress: 'me@example.com', historyId: '8000' }),
  listHistory: async () => ({ messageIds: [externalId], latestHistoryId: historyId }),
  fetchMessageById: async (id: string) => ({
    id, threadId: 'th-1', subject: `@${username} sent you a new message!`,
    from: 'VGen <no-reply@vgen.co>', date: '2026-10-16T14:32:11.000Z',
  }),
};

const app = new Elysia().use(createGmailWebhookRoutes({ resolveGmailClient: async () => gmail, audience: null }));
const deliver = () => app.handle(new Request('http://localhost/api/v1/webhooks/google/gmail', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(push()),
}));

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(agentTasks).where(eq(agentTasks.id, id));
  await db.delete(events).where(eq(events.externalId, externalId));
  await db.delete(clients).where(eq(clients.username, username));
  await redis.del(notificationsStream);
  await deleteIntegration(ownerId, 'gmail');
  redis.disconnect();
});

describe('Phase 1 event pipeline end to end', () => {
  it('turns one VGen notification into exactly one Discord message', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });

    // Pub/Sub delivers the same notification twice.
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200);

    const eventRows = await db.select().from(events).where(eq(events.externalId, externalId));
    expect(eventRows).toHaveLength(1);
    const event = eventRows[0]!;

    const processTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${event.id}:process`));
    expect(processTasks).toHaveLength(1);
    createdTaskIds.push(processTasks[0]!.id);
    await handleProcessGmailEvent({ id: '1-0', data: { taskId: String(processTasks[0]!.id) } }, { notificationsStream });

    const entries = await redis.xrange(notificationsStream, '-', '+');
    expect(entries).toHaveLength(1);
    const notifyTaskId = Number(fieldsToRecord(entries[0]![1] as string[]).taskId);

    const messages: string[] = [];
    const notifier: DiscordNotifier = {
      sendEventNotification: async (_channelId, notification) => { messages.push(JSON.stringify(notification)); return { messageId: 'msg-1' }; },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    await handleNotifyDiscord({ id: entries[0]![0], data: { taskId: String(notifyTaskId) } }, { notifier, channelId: 'chan-1' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(username);

    expect((await db.select().from(clients).where(eq(clients.username, username)))[0]!.platform).toBe('vgen');
    expect((await db.select().from(agentTasks).where(eq(agentTasks.id, notifyTaskId)))[0]!.status).toBe(TaskStatus.COMPLETED);
    createdTaskIds.push(notifyTaskId);
    expect((await db.select().from(events).where(eq(events.id, event.id)))[0]!.status as string).toBe('processed');
    expect((await db.select().from(agentTasks).where(eq(agentTasks.id, processTasks[0]!.id)))[0]!.type).toBe(TaskType.PROCESS_GMAIL_EVENT);
  });
});
