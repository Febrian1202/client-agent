import { Elysia } from 'elysia';
import { db, sql } from '@client-agent/db';
import { getRedisClient } from '@client-agent/queue';

export const healthRoutes = new Elysia()
  .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))
  .get('/health/ready', async ({ set }) => {
    let databaseStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await db.execute(sql`SELECT 1;`);
    } catch {
      databaseStatus = 'error';
    }

    try {
      const redis = getRedisClient();
      await redis.ping();
    } catch {
      redisStatus = 'error';
    }

    if (databaseStatus !== 'ok' || redisStatus !== 'ok') {
      set.status = 503;
      return {
        status: 'unready',
        database: databaseStatus,
        redis: redisStatus,
      };
    }

    return {
      status: 'ready',
      database: 'ok',
      redis: 'ok',
    };
  });
