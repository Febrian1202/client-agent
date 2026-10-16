import type Redis from 'ioredis';
import { consumeNextTask, type ParsedTask } from '@client-agent/queue';

export interface HandleTaskOptions {
  stream: string;
  group: string;
  consumer: string;
  redis: Redis;
  onProcess: (task: ParsedTask) => Promise<void>;
}

export async function handleTask(options: HandleTaskOptions): Promise<boolean> {
  const { stream, group, consumer, redis, onProcess } = options;

  const task = await consumeNextTask(redis, {
    stream,
    group,
    consumer,
    blockMs: 1000,
  });

  if (!task) {
    return false;
  }

  try {
    await onProcess(task);
    await redis.xack(stream, group, task.id);
    return true;
  } catch (err) {
    console.error(`[Worker] Error processing task ${task.id}:`, err);
    return false;
  }
}
