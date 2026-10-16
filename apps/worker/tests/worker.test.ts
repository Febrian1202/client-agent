import { describe, expect, it } from 'bun:test';
import { formatHeartbeat } from '../src/heartbeat';
import {
  STREAMS,
  createConsumerGroupIfNotExists,
  createRedisClient,
  publishTask,
} from '@client-agent/queue';
import { handleTask } from '../src/taskHandler';

describe('Worker Heartbeat and Task Consumer', () => {
  it('formats heartbeat log message with ISO timestamp', () => {
    const log = formatHeartbeat('worker-1');
    expect(log).toContain('worker-1');
    expect(log).toContain('alive at');
  });

  it('processes and acknowledges task from Redis Stream', async () => {
    const stream = `${STREAMS.EVENTS}_worker_test_${Date.now()}`;
    const group = 'worker_test_group';

    await createConsumerGroupIfNotExists(stream, group);
    const entryId = await publishTask(stream, { type: 'TEST_TASK', foo: 'bar' });

    let processed = false;
    const redis = createRedisClient();

    await handleTask({
      stream,
      group,
      consumer: 'test_consumer',
      redis,
      onProcess: async (task) => {
        expect(task.id).toBe(entryId);
        expect(task.data.type).toBe('TEST_TASK');
        expect(task.data.foo).toBe('bar');
        processed = true;
      },
    });

    expect(processed).toBeTrue();

    // Clean up
    await redis.del(stream);
    redis.disconnect();
  });
});
