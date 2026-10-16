import Redis, { type RedisOptions } from 'ioredis';
import { config } from '@client-agent/config';

export function createRedisClient(options?: RedisOptions): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    ...options,
  });
}

let defaultRedisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!defaultRedisClient) {
    defaultRedisClient = createRedisClient();
  }
  return defaultRedisClient;
}
