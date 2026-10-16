import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db, events, agentTasks, clients, getOwnerUserId,
  insertEventIfNew, createTask, getTaskById, getEventById, markTaskCompleted,
} from '@client-agent/db';
import { TaskStatus, TaskType, VGenEventType } from '@client-agent/domain';
import { STREAMS, createRedisClient } from '@client-agent/queue';
import { handleProcessGmailEvent } from '../src/handlers/processGmailEvent';

const externalId = `worker-${Date.now()}`;
const username = `WorkerUser${Date.now()}`;
const notificationsStream = `${STREAMS.NOTIFICATIONS}_test_${Date.now()}`;
const redis = createRedisClient();
const ownerId = await getOwnerUserId();
const createdEventIds: number[] = [];
const createdTaskIds: number[] = [];

// Reads a Redis stream field list into a plain record so assertions do not depend on key order.
function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) record[fields[i]!] = fields[i + 1]!;
  return record;
}

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(agentTasks).where(eq(agentTasks.id, id));
  for (const id of createdEventIds) await db.delete(events).where(eq(events.id, id));
  await db.delete(clients).where(eq(clients.username, username));
  await redis.del(notificationsStream);
  redis.disconnect();
});

async function seed() {
  const event = (await insertEventIfNew({
    source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE, externalId: `${externalId}-${createdEventIds.length}`,
    payload: { subject: 's', from: 'f', date: 'd', clientUsername: username, commissionId: null, historyId: '1' },
    receivedAt: new Date(),
  }))!;
  createdEventIds.push(event.id);
  const task = await createTask({ userId: ownerId, eventId: event.id, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: event.id }, idempotencyKey: `gmail_event:${event.id}:process` });
  createdTaskIds.push(task.id);
  return { event, task };
}

describe('PROCESS_GMAIL_EVENT handler', () => {
  it('upserts the client, enqueues exactly one NOTIFY_DISCORD task, and marks the event processed', async () => {
    const { event, task } = await seed();
    await handleProcessGmailEvent({ id: '1-0', data: { taskId: String(task.id), type: TaskType.PROCESS_GMAIL_EVENT } }, { notificationsStream });

    const client = (await db.select().from(clients).where(eq(clients.username, username)))[0]!;
    expect(client.platform).toBe('vgen');

    const notifyKey = `gmail_event:${event.id}:notify`;
    const notifyTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, notifyKey));
    expect(notifyTasks).toHaveLength(1);
    expect(notifyTasks[0]!.type).toBe(TaskType.NOTIFY_DISCORD);
    createdTaskIds.push(notifyTasks[0]!.id);

    const entries = await redis.xrange(notificationsStream, '-', '+');
    expect(entries).toHaveLength(1);
    const record = fieldsToRecord(entries[0]![1] as string[]);
    expect(record.type).toBe(TaskType.NOTIFY_DISCORD);
    expect(record.taskId).toBe(String(notifyTasks[0]!.id));

    expect((await getEventById(event.id))!.status as string).toBe('processed');
    expect((await getTaskById(task.id))!.status).toBe(TaskStatus.COMPLETED);
  });

  it('does not duplicate the notify task when the same event is processed again', async () => {
    const before = (await redis.xrange(notificationsStream, '-', '+')).length;
    const { event, task } = await seed();
    await handleProcessGmailEvent({ id: '1-1', data: { taskId: String(task.id) } }, { notificationsStream });

    // A second, distinct process task for the same event must reuse the notify task found by idempotency key.
    const secondProcess = await createTask({
      userId: ownerId, eventId: event.id, type: TaskType.PROCESS_GMAIL_EVENT,
      input: { eventId: event.id }, idempotencyKey: `gmail_event:${event.id}:process:second`,
    });
    createdTaskIds.push(secondProcess.id);
    await handleProcessGmailEvent({ id: '1-2', data: { taskId: String(secondProcess.id) } }, { notificationsStream });

    // A redelivery of an already completed task is a no-op.
    await handleProcessGmailEvent({ id: '1-3', data: { taskId: String(task.id) } }, { notificationsStream });

    const notifyTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${event.id}:notify`));
    expect(notifyTasks).toHaveLength(1);
    createdTaskIds.push(notifyTasks[0]!.id);
    expect((await db.select().from(clients).where(eq(clients.username, username)))).toHaveLength(1);
    expect((await redis.xrange(notificationsStream, '-', '+'))).toHaveLength(before + 2);
  });

  it('marks the task failed when the event row is missing', async () => {
    const task = await createTask({ userId: ownerId, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: 999999 }, idempotencyKey: `missing-event-${externalId}` });
    createdTaskIds.push(task.id);
    await expect(handleProcessGmailEvent({ id: '2-0', data: { taskId: String(task.id) } }, { notificationsStream })).rejects.toThrow();
    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.FAILED);
    expect(row!.error).toBeTruthy();
  });

  it('does not publish to notifications stream when existing notify task is already completed', async () => {
    const { event, task } = await seed();
    await handleProcessGmailEvent({ id: '3-0', data: { taskId: String(task.id) } }, { notificationsStream });

    const notifyKey = `gmail_event:${event.id}:notify`;
    const notifyTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, notifyKey));
    expect(notifyTasks).toHaveLength(1);
    const notifyTask = notifyTasks[0]!;
    createdTaskIds.push(notifyTask.id);

    await markTaskCompleted(notifyTask.id, { messageId: 'msg-already-sent' });

    const before = (await redis.xrange(notificationsStream, '-', '+')).length;

    const secondProcess = await createTask({
      userId: ownerId,
      eventId: event.id,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { eventId: event.id },
      idempotencyKey: `gmail_event:${event.id}:process:third`,
    });
    createdTaskIds.push(secondProcess.id);
    await handleProcessGmailEvent({ id: '3-1', data: { taskId: String(secondProcess.id) } }, { notificationsStream });

    expect((await redis.xrange(notificationsStream, '-', '+'))).toHaveLength(before);

    const notifyTasksAfter = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, notifyKey));
    expect(notifyTasksAfter).toHaveLength(1);
  });
});
