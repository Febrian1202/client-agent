import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db, getOwnerUserId, insertEventIfNew, getEventById, markEventProcessed,
  createTask, getTaskById, findTaskByIdempotencyKey, markTaskRunning, markTaskCompleted,
  upsertClient, getClientByUsername, upsertIntegration, getIntegration, deleteIntegration,
  agentTasks, events, clients, integrations,
} from '../src/index';
import { TaskType, VGenEventType } from '@client-agent/domain';

const externalId = `queries-${Date.now()}`;
const username = `QueriesUser${Date.now()}`;
const provider = `queries-test-${Date.now()}`;

afterAll(async () => {
  await db.delete(agentTasks).where(eq(agentTasks.idempotencyKey, `queries:${externalId}`));
  await db.delete(events).where(eq(events.externalId, externalId));
  await db.delete(clients).where(eq(clients.username, username));
  await db.delete(integrations).where(eq(integrations.provider, provider));
});

describe('Phase 1 query helpers', () => {
  it('returns the owner user id', async () => {
    expect(await getOwnerUserId()).toBeGreaterThan(0);
  });

  it('inserts an event once and returns null on the duplicate', async () => {
    const input = {
      source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE,
      externalId, payload: { subject: 's', from: 'f', date: 'd', clientUsername: username, commissionId: null, historyId: '1' },
      receivedAt: new Date('2026-10-16T14:32:00Z'),
    };
    const first = await insertEventIfNew(input);
    expect(first).not.toBeNull();
    expect(await insertEventIfNew(input)).toBeNull();
    await markEventProcessed(first!.id);
    expect((await getEventById(first!.id))!.status as string).toBe('processed');
  });

  it('creates a task, finds it by idempotency key, and walks running -> completed', async () => {
    const userId = await getOwnerUserId();
    const task = await createTask({ userId, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: 1 }, idempotencyKey: `queries:${externalId}` });
    expect(task.status as string).toBe('queued');
    expect((await findTaskByIdempotencyKey(`queries:${externalId}`))!.id).toBe(task.id);
    await markTaskRunning(task.id);
    const running = await getTaskById(task.id);
    expect(running!.status as string).toBe('running');
    expect(running!.attempts).toBe(1);
    expect(running!.startedAt).toBeInstanceOf(Date);
    await markTaskCompleted(task.id, { messageId: 'm1' });
    const done = await getTaskById(task.id);
    expect(done!.status as string).toBe('completed');
    expect(done!.output).toEqual({ messageId: 'm1' });
  });

  it('upserts a client in place and refreshes last_seen_at', async () => {
    const userId = await getOwnerUserId();
    const first = await upsertClient({ userId, platform: 'vgen', username });
    const second = await upsertClient({ userId, platform: 'vgen', username });
    expect(second.id).toBe(first.id);
    expect(second.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
    expect((await getClientByUsername(userId, 'vgen', username))!.id).toBe(first.id);
  });

  it('upserts and deletes an integration', async () => {
    const userId = await getOwnerUserId();
    await upsertIntegration({ userId, provider, status: 'connected', credentialsEncrypted: 'v1.a.b', metadata: { channelId: 'c1' } });
    await upsertIntegration({ userId, provider, status: 'error', metadata: { channelId: 'c1' } });
    const row = await getIntegration(userId, provider);
    expect(row!.status).toBe('error');
    expect(row!.metadata).toEqual({ channelId: 'c1' });
    await deleteIntegration(userId, provider);
    expect(await getIntegration(userId, provider)).toBeNull();
  });
});
