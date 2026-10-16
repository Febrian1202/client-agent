import {
  consumeNextTask,
  runTask,
  type ParsedTask,
  type Redis,
} from '@client-agent/queue';

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

  const result = await runTask({
    redis,
    stream,
    group,
    task,
    handler: onProcess,
  });

  return result.status === 'completed';
}
