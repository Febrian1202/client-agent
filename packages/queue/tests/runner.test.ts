import { describe, expect, it, afterAll, spyOn } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  getTaskById,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import {
  createRedisClient,
  createConsumerGroupIfNotExists,
  publishTask,
  runTask,
  clearRetries,
  STREAMS,
} from '../src';

describe('Task Runner State Machine', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_runner_${Date.now()}`;
  const testGroup = 'runner_group';
  const createdTaskIds: number[] = [];
  let ownerId: number;

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
    await clearRetries(redis);
    await redis.del(testStream);
    redis.disconnect();
  });

  it('handles success: transitions to completed, updates output, and ACKs message', async () => {
    ownerId = await getOwnerUserId();
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);

    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { foo: 'bar' },
    });
    createdTaskIds.push(task.id);

    const messageId = await publishTask(testStream, { taskId: String(task.id) });

    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: messageId, data: { taskId: String(task.id) } },
      handler: async () => ({ processed: true }),
    });

    expect(result.status).toBe('completed');
    const updated = await getTaskById(task.id);
    expect(updated!.status).toBe(TaskStatus.COMPLETED);
    expect(updated!.output).toEqual({ processed: true });
    expect(updated!.attempts).toBe(1);

    // Verify ACKed (no pending items)
    const pending = await redis.xpending(testStream, testGroup);
    expect(pending[0]).toBe(0);
  });

  it('handles transient error: marks failed, schedules retry backoff, and ACKs stream entry', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { errorTest: true },
    });
    createdTaskIds.push(task.id);

    const messageId = await publishTask(testStream, { taskId: String(task.id) });

    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: messageId, data: { taskId: String(task.id) } },
      retryDelays: [50, 100],
      handler: async () => {
        throw new Error('Transient network glitch');
      },
    });

    expect(result.status).toBe('retried');
    const updated = await getTaskById(task.id);
    expect(updated!.status).toBe(TaskStatus.FAILED);
    expect(updated!.error).toBe('Transient network glitch');
    expect(updated!.attempts).toBe(1);
  });

  it('handles dead-letter: marks dead when attempts reach max_attempts and ACKs message', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { deadTest: true },
    });
    createdTaskIds.push(task.id);

    // Manually set attempts to 4 with maxAttempts 5
    await db.update(agentTasks).set({ attempts: 4, maxAttempts: 5 }).where(eq(agentTasks.id, task.id));

    const messageId = await publishTask(testStream, { taskId: String(task.id) });

    let deadLetterAlertTriggered = false;
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: messageId, data: { taskId: String(task.id) } },
      onDeadLetter: async () => {
        deadLetterAlertTriggered = true;
      },
      handler: async () => {
        throw new Error('Fatal unrecoverable failure');
      },
    });

    expect(result.status).toBe('dead');
    expect(deadLetterAlertTriggered).toBeTrue();
    const updated = await getTaskById(task.id);
    expect(updated!.status).toBe(TaskStatus.DEAD);
    expect(updated!.error).toBe('Fatal unrecoverable failure');
    expect(updated!.attempts).toBe(5);

    // Verify ACKed (stream not poisoned)
    const pending = await redis.xpending(testStream, testGroup);
    expect(pending[0]).toBe(0);
  });

  it('safely ACKs and skips invalid stream payload without crashing (Review Focus #1)', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-0', data: {} }, // Missing taskId
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('invalid_payload');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('safely ACKs and skips non-existent task ID in database (Review Focus #2)', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-1', data: { taskId: '99999999' } },
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not_found');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('safely ACKs and skips already completed tasks', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { alreadyDone: true },
    });
    createdTaskIds.push(task.id);
    await db.update(agentTasks).set({ status: TaskStatus.COMPLETED }).where(eq(agentTasks.id, task.id));

    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-2', data: { taskId: String(task.id) } },
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('already_completed');
  });

  it('safely ACKs and skips already dead tasks', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { alreadyDead: true },
    });
    createdTaskIds.push(task.id);
    await db.update(agentTasks).set({ status: TaskStatus.DEAD }).where(eq(agentTasks.id, task.id));

    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-3', data: { taskId: String(task.id) } },
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('already_dead');
  });

  it('safely ACKs and skips non-numeric taskId payload', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-4', data: { taskId: 'not-a-number' } },
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('invalid_payload');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
