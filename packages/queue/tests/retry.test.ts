import { describe, expect, it, afterAll } from 'bun:test';
import {
  createRedisClient,
  calculateBackoffDelay,
  scheduleRetry,
  pollDueRetries,
  clearRetries,
  STREAMS,
} from '../src';

describe('Queue Retry and Exponential Backoff Scheduler', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_retry_test_${Date.now()}`;

  afterAll(async () => {
    await clearRetries(redis);
    await redis.del(testStream);
    redis.disconnect();
  });

  it('calculates bounded exponential backoff delay based on attempts', () => {
    expect(calculateBackoffDelay(1)).toBe(2_000);
    expect(calculateBackoffDelay(2)).toBe(10_000);
    expect(calculateBackoffDelay(3)).toBe(30_000);
    expect(calculateBackoffDelay(4)).toBe(60_000);
    expect(calculateBackoffDelay(5)).toBe(60_000); // capped at maximum backoff
  });

  it('allows custom retry backoff delays array', () => {
    const custom = [100, 500, 1000];
    expect(calculateBackoffDelay(1, custom)).toBe(100);
    expect(calculateBackoffDelay(2, custom)).toBe(500);
    expect(calculateBackoffDelay(3, custom)).toBe(1000);
    expect(calculateBackoffDelay(10, custom)).toBe(1000);
  });

  it('schedules a task to retry ZSET and polls it when due', async () => {
    await clearRetries(redis);

    // Schedule task with 50ms delay
    await scheduleRetry(redis, testStream, { taskId: '999', type: 'TEST' }, 50);

    // Polling immediately should find 0 due tasks
    const countImmediate = await pollDueRetries(redis);
    expect(countImmediate).toBe(0);

    // Wait 60ms for task to become due
    await Bun.sleep(60);

    // Polling now should publish to stream and return 1
    const countDue = await pollDueRetries(redis);
    expect(countDue).toBe(1);

    // Verify task arrived in Redis stream
    const entries = await redis.xrange(testStream, '-', '+');
    expect(entries.length).toBe(1);
    expect(entries[0]![1]).toContain('999');

    // Polling again should find 0
    const countAfter = await pollDueRetries(redis);
    expect(countAfter).toBe(0);
  });

  it('handles edge cases in backoff calculation', () => {
    expect(calculateBackoffDelay(0)).toBe(2_000);
    expect(calculateBackoffDelay(-1)).toBe(2_000);
    expect(calculateBackoffDelay(1, [])).toBe(0);
  });

  it('respects limit when polling due retries', async () => {
    await clearRetries(redis);

    await scheduleRetry(redis, testStream, { taskId: '1' }, 0);
    await scheduleRetry(redis, testStream, { taskId: '2' }, 0);
    await scheduleRetry(redis, testStream, { taskId: '3' }, 0);

    const firstBatch = await pollDueRetries(redis, 2);
    expect(firstBatch).toBe(2);

    const secondBatch = await pollDueRetries(redis, 2);
    expect(secondBatch).toBe(1);

    const thirdBatch = await pollDueRetries(redis, 2);
    expect(thirdBatch).toBe(0);
  });
});
