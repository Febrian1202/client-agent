import { afterAll, describe, expect, it } from 'bun:test';
import {
  createConsumerGroupIfNotExists,
  createRedisClient,
  STREAMS,
} from '@client-agent/queue';
import { startWorker } from '../src/consumers';
import { handleTask } from '../src/taskHandler';

describe('Worker Graceful Shutdown & Active Jobs Tracking (Review Focus #4)', () => {
  const redis = createRedisClient();

  afterAll(async () => {
    redis.disconnect();
  });

  it('drains active in-flight jobs cleanly on shutdown', async () => {
    const testStream = `${STREAMS.EVENTS}_shutdown_${Date.now()}`;
    const group = 'shutdown_group';
    let jobStarted = false;
    let jobFinished = false;

    const worker = await startWorker({
      workerId: 'shutdown-test-worker',
      group,
      redis,
      retryPollIntervalMs: 50,
      consumers: [
        {
          stream: testStream,
          handler: async () => {
            jobStarted = true;
            await Bun.sleep(150);
            jobFinished = true;
          },
        },
      ],
    });

    // Verify active jobs starts at 0
    expect(worker.getActiveJobsCount()).toBe(0);

    // Enqueue message
    await redis.xadd(testStream, '*', 'type', 'TEST', 'taskId', '1');

    // Wait until job starts
    while (!jobStarted) {
      await Bun.sleep(20);
    }
    expect(worker.getActiveJobsCount()).toBe(1);

    // Call shutdown while job is in-flight
    const shutdownPromise = worker.shutdown(2000);
    expect(worker.isShuttingDown()).toBeTrue();

    await shutdownPromise;
    expect(jobFinished).toBeTrue();
    expect(worker.getActiveJobsCount()).toBe(0);

    await redis.del(testStream);
  });

  it('strictly bounds shutdown duration when in-flight job exceeds timeout', async () => {
    const stream = `${STREAMS.EVENTS}_timeout_${Date.now()}`;
    const group = 'timeout_group';
    let jobStarted = false;
    let jobCompleted = false;

    const worker = await startWorker({
      workerId: 'timeout-test-worker',
      group: 'timeout_group',
      redis,
      retryPollIntervalMs: 50,
      consumers: [
        {
          stream,
          handler: async () => {
            jobStarted = true;
            await Bun.sleep(1000);
            jobCompleted = true;
          },
        },
      ],
    });

    await redis.xadd(stream, '*', 'type', 'TEST', 'taskId', '1');
    while (!jobStarted) {
      await Bun.sleep(20);
    }
    expect(worker.getActiveJobsCount()).toBe(1);

    const shutdownStart = Date.now();
    await worker.shutdown(100);
    const shutdownDuration = Date.now() - shutdownStart;

    // Must return within ~150-350ms even though job takes 1000ms
    expect(shutdownDuration).toBeLessThan(350);
    expect(jobCompleted).toBeFalse();

    await redis.del(stream);
  });

  it('does not process messages if shutdown has already started', async () => {
    const stream = `${STREAMS.EVENTS}_no_process_${Date.now()}`;
    const group = 'no_process_group';
    await createConsumerGroupIfNotExists(stream, group, redis);

    let processed = false;
    await redis.xadd(stream, '*', 'type', 'TEST', 'taskId', '1');

    const result = await handleTask({
      stream,
      group,
      consumer: 'test_consumer',
      redis,
      isShuttingDown: () => true,
      onProcess: async () => {
        processed = true;
      },
    });

    expect(result).toBeFalse();
    expect(processed).toBeFalse();

    await redis.del(stream);
  });

  it('does not process message if shutdown begins while message is received', async () => {
    const stream = `${STREAMS.EVENTS}_shutdown_mid_${Date.now()}`;
    const group = 'shutdown_mid_group';
    await createConsumerGroupIfNotExists(stream, group, redis);

    let processed = false;
    let callCount = 0;
    await redis.xadd(stream, '*', 'type', 'TEST', 'taskId', '1');

    // First check (before consumeNextTask) returns false;
    // Second check (after consumeNextTask returns) returns true!
    const result = await handleTask({
      stream,
      group,
      consumer: 'test_consumer',
      redis,
      isShuttingDown: () => {
        callCount++;
        return callCount > 1;
      },
      onProcess: async () => {
        processed = true;
      },
    });

    expect(result).toBeFalse();
    expect(processed).toBeFalse();

    // Verify task was consumed from stream but remains unacknowledged in Redis PEL
    const pending = await redis.xpending(stream, group);
    expect(Number(pending[0])).toBe(1);

    await redis.del(stream);
  });
});
