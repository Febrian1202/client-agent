import {
  createConsumerGroupIfNotExists,
  pollDueRetries,
  recoverPendingTasks,
  runTask,
  type ParsedTask,
  type Redis,
} from '@client-agent/queue';
import { getTaskById } from '@client-agent/db';
import { formatHeartbeat } from './heartbeat';
import { handleTask } from './taskHandler';

export interface WorkerConsumer {
  stream: string;
  handler: (task: ParsedTask, redis: Redis) => Promise<unknown>;
}

export interface StartWorkerOptions {
  workerId: string;
  group: string;
  consumers: WorkerConsumer[];
  redis: Redis;
  retryPollIntervalMs?: number;
}

export interface WorkerHandle {
  shutdown: (timeoutMs?: number) => Promise<void>;
  getActiveJobsCount: () => number;
  isShuttingDown: () => boolean;
}

export async function startWorker(options: StartWorkerOptions): Promise<WorkerHandle> {
  const { workerId, group, consumers, redis, retryPollIntervalMs = 1000 } = options;

  let activeJobsCount = 0;
  let isShuttingDown = false;
  let isRunning = true;

  for (const consumer of consumers) {
    await createConsumerGroupIfNotExists(consumer.stream, group, redis);
    console.log(`Worker listening on stream: ${consumer.stream} (Group: ${group})`);
  }

  for (const consumer of consumers) {
    try {
      const recovered = await recoverPendingTasks({
        redis,
        stream: consumer.stream,
        group,
        consumer: workerId,
      });
      for (const task of recovered) {
        activeJobsCount++;
        try {
          const rawTaskId = task.data?.taskId;
          const taskId = rawTaskId ? Number(rawTaskId) : NaN;
          const taskRow = !Number.isNaN(taskId) && taskId > 0 ? await getTaskById(taskId) : null;
          if (taskRow) {
            await runTask({
              redis,
              stream: consumer.stream,
              group,
              task,
              handler: (t) => consumer.handler(t, redis),
            });
          } else {
            await consumer.handler(task, redis);
            await redis.xack(consumer.stream, group, task.id);
          }
        } catch (err) {
          console.error(`[worker] Error processing recovered task ${task.id}:`, err);
        } finally {
          activeJobsCount--;
        }
      }
    } catch (err) {
      console.error(`[worker] Error recovering pending tasks for ${consumer.stream}:`, err);
    }
  }

  const heartbeatInterval = setInterval(() => {
    console.log(formatHeartbeat(workerId));
  }, 30_000);
  console.log(formatHeartbeat(workerId));

  const retryInterval = setInterval(async () => {
    try {
      await pollDueRetries(redis);
    } catch (err) {
      if (!isShuttingDown) {
        console.error('[worker] Error polling due retries:', err);
      }
    }
  }, retryPollIntervalMs);

  const loops = consumers.map((consumer) =>
    runConsumerLoop({
      consumer,
      workerId,
      group,
      redis,
      isRunning: () => isRunning && !isShuttingDown,
      onJobStart: () => {
        activeJobsCount++;
      },
      onJobEnd: () => {
        activeJobsCount--;
      },
    }),
  );

  const shutdown = async (timeoutMs: number = 15000): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    isRunning = false;

    clearInterval(heartbeatInterval);
    clearInterval(retryInterval);

    const start = Date.now();
    while (activeJobsCount > 0 && Date.now() - start < timeoutMs) {
      await Bun.sleep(50);
    }

    if (activeJobsCount > 0) {
      console.warn(
        `[worker] Shutdown timeout of ${timeoutMs}ms exceeded with ${activeJobsCount} active job(s) still in-flight`,
      );
    }

    const elapsed = Date.now() - start;
    const remainingMs = Math.max(0, timeoutMs - elapsed);
    if (remainingMs > 0) {
      await Promise.race([Promise.allSettled(loops), Bun.sleep(remainingMs)]);
    }
  };

  return {
    shutdown,
    getActiveJobsCount: () => activeJobsCount,
    isShuttingDown: () => isShuttingDown,
  };
}

interface ConsumerLoopOptions {
  consumer: WorkerConsumer;
  workerId: string;
  group: string;
  redis: Redis;
  isRunning: () => boolean;
  onJobStart: () => void;
  onJobEnd: () => void;
}

async function runConsumerLoop(options: ConsumerLoopOptions): Promise<void> {
  const { consumer, workerId, group, redis, isRunning, onJobStart, onJobEnd } = options;

  while (isRunning()) {
    try {
      let entryId: string | null = null;
      const processed = await handleTask({
        stream: consumer.stream,
        group,
        consumer: workerId,
        redis,
        isShuttingDown: () => !isRunning(),
        onProcess: async (task) => {
          onJobStart();
          try {
            entryId = task.id;
            return await consumer.handler(task, redis);
          } finally {
            onJobEnd();
          }
        },
      });

      if (processed && entryId) {
        console.log(`[worker] ${consumer.stream} ${entryId}`);
      }
    } catch (err) {
      if (isRunning()) {
        console.error(`[worker] ${consumer.stream} consumer loop error:`, err);
        await Bun.sleep(1000);
      }
    }
  }
}
