import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { formatHeartbeat } from '../src/heartbeat';
import {
  STREAMS,
  createConsumerGroupIfNotExists,
  createRedisClient,
  publishTask,
} from '@client-agent/queue';
import {
  agentTasks,
  createTask,
  db,
  getOwnerUserId,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { eq } from 'drizzle-orm';
import { handleTask } from '../src/taskHandler';

describe('Worker Heartbeat and Task Consumer', () => {
  const redis = createRedisClient();
  const createdTaskIds: number[] = [];

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
    redis.disconnect();
  });

  it('formats heartbeat log message with ISO timestamp', () => {
    const log = formatHeartbeat('worker-1');
    expect(log).toContain('worker-1');
    expect(log).toContain('alive at');
  });

  it('processes and acknowledges task from Redis Stream via runTask', async () => {
    const stream = `${STREAMS.EVENTS}_worker_test_${Date.now()}`;
    const group = 'worker_test_group';

    const ownerId = await getOwnerUserId();
    const taskRecord = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { foo: 'bar' },
    });
    createdTaskIds.push(taskRecord.id);

    await createConsumerGroupIfNotExists(stream, group);
    const entryId = await publishTask(stream, {
      taskId: String(taskRecord.id),
      type: 'TEST_TASK',
      foo: 'bar',
    });

    let processed = false;

    const success = await handleTask({
      stream,
      group,
      consumer: 'test_consumer',
      redis,
      onProcess: async (task) => {
        expect(task.id).toBe(entryId);
        expect(task.data.taskId).toBe(String(taskRecord.id));
        expect(task.data.type).toBe('TEST_TASK');
        expect(task.data.foo).toBe('bar');
        processed = true;
      },
    });

    expect(success).toBeTrue();
    expect(processed).toBeTrue();

    const taskRows = await db.select().from(agentTasks).where(eq(agentTasks.id, taskRecord.id));
    expect(taskRows[0]?.status).toBe(TaskStatus.COMPLETED);

    const pending = await redis.xpending(stream, group);
    expect(Number(pending[0])).toBe(0);

    // Clean up
    await redis.del(stream);
  });

  it('safely skips and ACKs invalid poison pill stream message', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const stream = `${STREAMS.EVENTS}_worker_poison_${Date.now()}`;
    const group = 'worker_poison_group';
    await createConsumerGroupIfNotExists(stream, group);

    // Missing taskId
    await publishTask(stream, { type: 'POISON_PILL', bad: 'data' });

    let processed = false;
    const success = await handleTask({
      stream,
      group,
      consumer: 'test_consumer',
      redis,
      onProcess: async () => {
        processed = true;
      },
    });

    expect(success).toBeFalse();
    expect(processed).toBeFalse();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // Verify ACKed (not left dangling in PEL)
    const pending = await redis.xpending(stream, group);
    expect(Number(pending[0])).toBe(0);

    await redis.del(stream);
  });

  it('safely skips and ACKs phantom task not present in DB', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const stream = `${STREAMS.EVENTS}_worker_phantom_${Date.now()}`;
    const group = 'worker_phantom_group';
    await createConsumerGroupIfNotExists(stream, group);

    await publishTask(stream, { taskId: '999999999', type: 'PHANTOM' });

    let processed = false;
    const success = await handleTask({
      stream,
      group,
      consumer: 'test_consumer',
      redis,
      onProcess: async () => {
        processed = true;
      },
    });

    expect(success).toBeFalse();
    expect(processed).toBeFalse();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    // Verify ACKed (not left dangling in PEL)
    const pending = await redis.xpending(stream, group);
    expect(Number(pending[0])).toBe(0);

    await redis.del(stream);
  });
});
