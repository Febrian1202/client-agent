import type { Redis } from './index';
import { getRedisClient } from './connection';

export async function createConsumerGroupIfNotExists(
  stream: string,
  group: string,
  redisClient?: Redis
): Promise<void> {
  const redis = redisClient ?? getRedisClient();
  try {
    // Start from '0' so pre-existing stream messages are not missed
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
  } catch (err: unknown) {
    const message = (err as Error)?.message || '';
    if (!message.includes('BUSYGROUP')) {
      throw err;
    }
  }
}

export interface ParsedTask {
  id: string;
  data: Record<string, string>;
}

export interface ConsumeOptions {
  stream: string;
  group: string;
  consumer: string;
  batchSize?: number;
  blockMs?: number;
}

export async function consumeNextTask(
  redis: Redis,
  options: ConsumeOptions
): Promise<ParsedTask | null> {
  const { stream, group, consumer, batchSize = 1, blockMs = 2000 } = options;

  const rawResult = await redis.xreadgroup(
    'GROUP',
    group,
    consumer,
    'COUNT',
    batchSize,
    'BLOCK',
    blockMs,
    'STREAMS',
    stream,
    '>'
  );

  const result = rawResult as [string, [string, string[]][]][] | null;

  if (!result || result.length === 0) {
    return null;
  }

  const streamEntries = result[0]![1];
  if (streamEntries.length === 0) {
    return null;
  }

  const [id, fields] = streamEntries[0]!;
  const data: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]!] = fields[i + 1]!;
  }

  return { id, data };
}
