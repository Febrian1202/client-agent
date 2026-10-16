import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, events, agentTasks, getOwnerUserId, insertEventIfNew, createTask, getTaskById } from '@client-agent/db';
import { TaskStatus, TaskType, VGenEventType } from '@client-agent/domain';
import type { DiscordNotifier } from '@client-agent/discord';
import { handleNotifyDiscord } from '../src/handlers/notifyDiscord';

const ownerId = await getOwnerUserId();
const createdTaskIds: number[] = [];
const createdEventIds: number[] = [];

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(agentTasks).where(eq(agentTasks.id, id));
  for (const id of createdEventIds) await db.delete(events).where(eq(events.id, id));
});

async function seed() {
  const externalId = `notify-${Date.now()}-${Math.random()}`;
  const event = (await insertEventIfNew({
    source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE, externalId,
    payload: { subject: '@ErianOsamu sent you a new message!', from: 'VGen <no-reply@vgen.co>', date: '2026-10-16T14:32:11.000Z', clientUsername: 'ErianOsamu', commissionId: null, historyId: '1' },
    receivedAt: new Date('2026-10-16T14:32:11.000Z'),
  }))!;
  createdEventIds.push(event.id);
  const task = await createTask({ userId: ownerId, eventId: event.id, type: TaskType.NOTIFY_DISCORD, input: { eventId: event.id }, idempotencyKey: `gmail_event:${event.id}:notify` });
  createdTaskIds.push(task.id);
  return { event, task };
}

describe('NOTIFY_DISCORD handler', () => {
  it('sends one notification and stores the message id', async () => {
    const { task } = await seed();
    const sent: unknown[] = [];
    const notifier: DiscordNotifier = {
      sendEventNotification: async (channelId, event) => { sent.push({ channelId, event }); return { messageId: 'msg-42' }; },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    await handleNotifyDiscord({ id: '1-0', data: { taskId: String(task.id) } }, { notifier, channelId: 'chan-1' });
    expect(sent).toHaveLength(1);
    expect((sent[0] as { event: { clientUsername: string } }).event.clientUsername).toBe('ErianOsamu');
    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.COMPLETED);
    expect(row!.output).toEqual({ messageId: 'msg-42' });
  });

  it('records the failure and leaves the task failed when Discord rejects', async () => {
    const { task } = await seed();
    const notifier: DiscordNotifier = {
      sendEventNotification: async () => { throw new Error('Missing Permissions'); },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    await expect(handleNotifyDiscord({ id: '1-1', data: { taskId: String(task.id) } }, { notifier, channelId: 'chan-1' })).rejects.toThrow('Missing Permissions');
    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.FAILED);
    expect(row!.error).toContain('Missing Permissions');
  });

  it('is a no-op when the task is already completed', async () => {
    const { task } = await seed();
    let calls = 0;
    const notifier: DiscordNotifier = {
      sendEventNotification: async () => { calls += 1; return { messageId: 'm' }; },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    const deps = { notifier, channelId: 'chan-1' };
    await handleNotifyDiscord({ id: '1-0', data: { taskId: String(task.id) } }, deps);
    await handleNotifyDiscord({ id: '1-1', data: { taskId: String(task.id) } }, deps);
    expect(calls).toBe(1);
  });
});
