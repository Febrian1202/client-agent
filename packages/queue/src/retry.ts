import type Redis from 'ioredis';
import { BACKOFF_DELAYS, RETRY_ZSET_KEY } from './constants';
import { publishTask } from './producer';

export { BACKOFF_DELAYS, RETRY_ZSET_KEY };

export interface RetryTaskEntry {
  stream: string;
  payload: Record<string, unknown>;
  scheduledAt: number;
  retryId?: string;
}

const LUA_POLL_SCRIPT = `
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #items > 0 then
  for i, item in ipairs(items) do
    redis.call('ZREM', KEYS[1], item)
  end
end
return items
`;

export function calculateBackoffDelay(
  attempts: number,
  delays: number[] = BACKOFF_DELAYS
): number {
  if (delays.length === 0) return 0;
  const index = Math.max(0, attempts - 1);
  if (index >= delays.length) {
    return delays[delays.length - 1]!;
  }
  return delays[index]!;
}

export async function scheduleRetry(
  redis: Redis,
  stream: string,
  payload: Record<string, unknown>,
  delayMs: number
): Promise<void> {
  const score = Date.now() + delayMs;
  const entry: RetryTaskEntry = {
    stream,
    payload,
    scheduledAt: Date.now(),
    retryId: crypto.randomUUID(),
  };

  await redis.zadd(RETRY_ZSET_KEY, score, JSON.stringify(entry));
}

export async function pollDueRetries(
  redis: Redis,
  limit: number = 50
): Promise<number> {
  const now = Date.now();
  const rawItems = (await redis.eval(
    LUA_POLL_SCRIPT,
    1,
    RETRY_ZSET_KEY,
    String(now),
    String(limit)
  )) as string[];

  if (!rawItems || rawItems.length === 0) {
    return 0;
  }

  let publishedCount = 0;
  for (const raw of rawItems) {
    try {
      const entry = JSON.parse(raw) as RetryTaskEntry;
      if (entry && entry.stream && entry.payload) {
        await publishTask(entry.stream, entry.payload, redis);
        publishedCount++;
      }
    } catch (err) {
      console.error('[queue:retry] Failed to republish due retry task:', err);
    }
  }

  return publishedCount;
}

export async function clearRetries(redis: Redis): Promise<void> {
  await redis.del(RETRY_ZSET_KEY);
}
