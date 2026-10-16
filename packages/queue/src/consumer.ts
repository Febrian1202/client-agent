import type Redis from 'ioredis';
import { getRedisClient } from './connection';

export async function createConsumerGroupIfNotExists(
  stream: string,
  group: string,
  redisClient?: Redis
): Promise<void> {
  const redis = redisClient ?? getRedisClient();
  try {
    // MKSTREAM option creates stream automatically if it doesn't exist
    await redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
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
  const { stream, group, consumer, blockMs = 2000 } = options;

  const result = await redis.xreadgroup(
    'GROUP',
    group,
    consumer,
    'COUNT',
    1,
    'BLOCK',
    blockMs,
    'STREAMS',
    stream,
    '>'
  );

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
