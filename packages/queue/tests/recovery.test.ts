import { describe, expect, it, afterAll } from 'bun:test';
import {
  createRedisClient,
  createConsumerGroupIfNotExists,
  publishTask,
  consumeNextTask,
  recoverPendingTasks,
  STREAMS,
} from '../src';

describe('Crash Resilience - Pending Entries Recovery', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_recovery_${Date.now()}`;
  const testGroup = 'recovery_group';
  const deadWorker = 'dead_worker_pid_123';
  const newWorker = 'recovering_worker_pid_456';

  afterAll(async () => {
    await redis.del(testStream);
    redis.disconnect();
  });

  it('claims orphaned unacknowledged messages after minIdleTime (Review Focus #5)', async () => {
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);

    // 1. Dead worker consumes a task but crashes before ACK
    const messageId = await publishTask(testStream, { taskId: '555', payload: 'crash-data' });
    const consumed = await consumeNextTask(redis, {
      stream: testStream,
      group: testGroup,
      consumer: deadWorker,
      blockMs: 1000,
    });
    expect(consumed).not.toBeNull();
    expect(consumed!.id).toBe(messageId);

    // Check pending count is 1
    const pendingBefore = await redis.xpending(testStream, testGroup);
    expect(pendingBefore[0]).toBe(1);

    // 2. Recovery runs immediately with minIdleTimeMs: 100 (should not claim yet)
    const claimedEarly = await recoverPendingTasks({
      redis,
      stream: testStream,
      group: testGroup,
      consumer: newWorker,
      minIdleTimeMs: 100,
    });
    expect(claimedEarly.length).toBe(0);

    // Wait 120ms to exceed idle time
    await Bun.sleep(120);

    // 3. New worker recovers orphaned tasks
    const claimed = await recoverPendingTasks({
      redis,
      stream: testStream,
      group: testGroup,
      consumer: newWorker,
      minIdleTimeMs: 100,
    });

    expect(claimed.length).toBe(1);
    expect(claimed[0]!.id).toBe(messageId);
    expect(claimed[0]!.data.taskId).toBe('555');

    // Clean up ACK
    await redis.xack(testStream, testGroup, messageId);
  });

  it('returns empty array when there are no pending tasks', async () => {
    const emptyStream = `${STREAMS.EVENTS}_empty_${Date.now()}`;
    await createConsumerGroupIfNotExists(emptyStream, testGroup, redis);

    const claimed = await recoverPendingTasks({
      redis,
      stream: emptyStream,
      group: testGroup,
      consumer: newWorker,
      minIdleTimeMs: 100,
    });

    expect(claimed).toEqual([]);
    await redis.del(emptyStream);
  });

  it('recovers multiple orphaned tasks across batches', async () => {
    const multiStream = `${STREAMS.EVENTS}_multi_${Date.now()}`;
    await createConsumerGroupIfNotExists(multiStream, testGroup, redis);

    // Publish 5 tasks
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await publishTask(multiStream, { taskId: `multi-${i}`, index: `${i}` });
      ids.push(id);
    }

    // Dead worker consumes all 5
    for (let i = 0; i < 5; i++) {
      const consumed = await consumeNextTask(redis, {
        stream: multiStream,
        group: testGroup,
        consumer: deadWorker,
        blockMs: 1000,
      });
      expect(consumed).not.toBeNull();
    }

    // Wait for idle time
    await Bun.sleep(120);

    // Recover with batchSize = 2 to force pagination
    const claimed = await recoverPendingTasks({
      redis,
      stream: multiStream,
      group: testGroup,
      consumer: newWorker,
      minIdleTimeMs: 100,
      batchSize: 2,
    });

    expect(claimed.length).toBe(5);
    const claimedIds = claimed.map((t) => t.id);
    for (const id of ids) {
      expect(claimedIds).toContain(id);
    }

    // Clean up
    await redis.xack(multiStream, testGroup, ...ids);
    await redis.del(multiStream);
  });
});
