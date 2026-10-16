import {
  consumeNextTask,
  runTask,
  type ParsedTask,
  type Redis,
} from '@client-agent/queue';
import { getTaskById } from '@client-agent/db';

export interface HandleTaskOptions {
  stream: string;
  group: string;
  consumer: string;
  redis: Redis;
  onProcess: (task: ParsedTask) => Promise<unknown>;
  isShuttingDown?: () => boolean;
}

export async function handleTask(options: HandleTaskOptions): Promise<boolean> {
  const { stream, group, consumer, redis, onProcess, isShuttingDown } = options;

  if (isShuttingDown?.()) {
    return false;
  }

  const task = await consumeNextTask(redis, {
    stream,
    group,
    consumer,
    blockMs: 1000,
  });

  if (!task || isShuttingDown?.()) {
    return false;
  }

  const rawTaskId = task.data?.taskId;
  const taskId = rawTaskId ? Number(rawTaskId) : NaN;
  const taskRow = !Number.isNaN(taskId) && taskId > 0 ? await getTaskById(taskId) : null;

  if (taskRow) {
    const result = await runTask({
      redis,
      stream,
      group,
      task,
      handler: onProcess,
    });
    return result.status === 'completed';
  }

  try {
    await onProcess(task);
    if (!isShuttingDown?.()) {
      await redis.xack(stream, group, task.id);
    }
    return true;
  } catch (err) {
    if (!isShuttingDown?.()) {
      console.error(`[Worker] Error processing task ${task.id}:`, err);
    }
    return false;
  }
}
