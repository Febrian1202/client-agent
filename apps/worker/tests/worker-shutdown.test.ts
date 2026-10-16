import { describe, expect, it } from 'bun:test';
import { createRedisClient, STREAMS } from '@client-agent/queue';
import { startWorker } from '../src/consumers';

describe('Worker Graceful Shutdown & Active Jobs Tracking (Review Focus #4)', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_shutdown_${Date.now()}`;
  const group = 'shutdown_group';

  it('drains active in-flight jobs cleanly on shutdown', async () => {
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
    redis.disconnect();
  });
});
