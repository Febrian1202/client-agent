import {
  createConsumerGroupIfNotExists,
  type ParsedTask,
  type Redis,
} from '@client-agent/queue';
import { formatHeartbeat } from './heartbeat';
import { handleTask } from './taskHandler';

export interface WorkerConsumer {
  stream: string;
  handler: (task: ParsedTask, redis: Redis) => Promise<void>;
}

export interface StartWorkerOptions {
  workerId: string;
  group: string;
  consumers: WorkerConsumer[];
  redis: Redis;
}

export interface WorkerHandle {
  shutdown: () => Promise<void>;
}

export async function startWorker(options: StartWorkerOptions): Promise<WorkerHandle> {
  const { workerId, group, consumers, redis } = options;

  for (const consumer of consumers) {
    await createConsumerGroupIfNotExists(consumer.stream, group, redis);
    console.log(`Worker listening on stream: ${consumer.stream} (Group: ${group})`);
  }

  let isRunning = true;

  const heartbeatInterval = setInterval(() => {
    console.log(formatHeartbeat(workerId));
  }, 30_000);
  console.log(formatHeartbeat(workerId));

  const loops = consumers.map((consumer) =>
    runConsumerLoop({ consumer, workerId, group, redis, isRunning: () => isRunning }),
  );

  const shutdown = async () => {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(heartbeatInterval);
    await Promise.allSettled(loops);
  };

  return { shutdown };
}

interface ConsumerLoopOptions {
  consumer: WorkerConsumer;
  workerId: string;
  group: string;
  redis: Redis;
  isRunning: () => boolean;
}

async function runConsumerLoop(options: ConsumerLoopOptions): Promise<void> {
  const { consumer, workerId, group, redis, isRunning } = options;

  while (isRunning()) {
    try {
      let entryId: string | null = null;
      const processed = await handleTask({
        stream: consumer.stream,
        group,
        consumer: workerId,
        redis,
        onProcess: async (task) => {
          entryId = task.id;
          await consumer.handler(task, redis);
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
