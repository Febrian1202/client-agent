import { describe, expect, it } from 'bun:test';
import { db, sql, users } from '@client-agent/db';
import {
  STREAMS,
  createConsumerGroupIfNotExists,
  createRedisClient,
  publishTask,
  consumeNextTask,
} from '@client-agent/queue';
import { app } from '../apps/api/src/app';
import { config } from '@client-agent/config';
import { getSession } from '../apps/api/src/auth/session';

describe('Phase 0 Foundation End-to-End Verification', () => {
  it('verifies PostgreSQL database connection and migrations', async () => {
    const res = await db.execute(sql`SELECT current_database() as db_name;`);
    expect(res).toBeDefined();
    expect(res[0]?.db_name).toBe('client_agent');

    const userRows = await db.select().from(users);
    expect(userRows.length).toBeGreaterThan(0);
    expect(userRows[0]?.name).toBe(config.AUTH_USERNAME);
  });

  it('verifies Redis Streams publishing and consumer group reading', async () => {
    const redis = createRedisClient();
    const pong = await redis.ping();
    expect(pong).toBe('PONG');

    const testStream = `${STREAMS.EVENTS}_e2e_${Date.now()}`;
    const testGroup = 'e2e_group';
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);

    const taskId = await publishTask(testStream, {
      type: 'E2E_VERIFICATION_EVENT',
      source: 'test-runner',
      timestamp: new Date().toISOString(),
    });
    expect(taskId).toBeString();

    const task = await consumeNextTask(redis, {
      stream: testStream,
      group: testGroup,
      consumer: 'e2e_consumer',
      blockMs: 2000,
    });

    expect(task).not.toBeNull();
    expect(task?.id).toBe(taskId);
    expect(task?.data.type).toBe('E2E_VERIFICATION_EVENT');

    // Ack and cleanup
    await redis.xack(testStream, testGroup, taskId);
    await redis.del(testStream);
    redis.disconnect();
  });

  it('verifies API health endpoints', async () => {
    const healthRes = await app.handle(new Request('http://localhost/health'));
    expect(healthRes.status).toBe(200);
    const healthBody = await healthRes.json();
    expect(healthBody.status).toBe('ok');

    const readyRes = await app.handle(new Request('http://localhost/health/ready'));
    expect(readyRes.status).toBe(200);
    const readyBody = await readyRes.json();
    expect(readyBody.status).toBe('ready');
    expect(readyBody.database).toBe('ok');
    expect(readyBody.redis).toBe('ok');
  });

  it('verifies full login, session creation, /me, and logout lifecycle', async () => {
    // 1. Valid login
    const loginRes = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.AUTH_USERNAME,
          password: 'admin123',
        }),
      })
    );
    expect(loginRes.status).toBe(200);

    const setCookie = loginRes.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('session=');

    const match = setCookie!.match(/session=([^;]+)/);
    const sessionId = match![1]!;

    // 2. Session exists in Redis
    const sessionData = await getSession(sessionId);
    expect(sessionData).not.toBeNull();
    expect(sessionData?.username).toBe(config.AUTH_USERNAME);

    // 3. /me returns authenticated user
    const meRes = await app.handle(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Cookie: `session=${sessionId}` },
      })
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.user.name).toBe(config.AUTH_USERNAME);

    // 4. Logout
    const logoutRes = await app.handle(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: { Cookie: `session=${sessionId}` },
      })
    );
    expect(logoutRes.status).toBe(200);

    // 5. Session is invalidated
    const postLogoutSession = await getSession(sessionId);
    expect(postLogoutSession).toBeNull();
  });
});
