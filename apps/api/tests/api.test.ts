import { describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { config } from '@client-agent/config';

describe('Elysia API Server Endpoints', () => {
  it('GET /health returns status ok', async () => {
    const res = await app.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeString();
  });

  it('GET /health/ready returns status ready with db and redis status', async () => {
    const res = await app.handle(new Request('http://localhost/health/ready'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.database).toBe('ok');
    expect(body.redis).toBe('ok');
  });

  it('POST /api/v1/auth/login rejects invalid credentials', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.AUTH_USERNAME,
          password: 'wrong_password_123',
        }),
      })
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/v1/auth/login succeeds with valid credentials and sets session cookie', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.AUTH_USERNAME,
          password: 'admin123',
        }),
      })
    );

    expect(res.status).toBe(200);
    const cookieHeader = res.headers.get('set-cookie');
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain('session=');

    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.name).toBe(config.AUTH_USERNAME);

    // Extract session cookie value
    const match = cookieHeader!.match(/session=([^;]+)/);
    const sessionId = match![1];

    // Verify GET /auth/me with session cookie
    const meRes = await app.handle(
      new Request('http://localhost/api/v1/auth/me', {
        headers: {
          Cookie: `session=${sessionId}`,
        },
      })
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.user.name).toBe(config.AUTH_USERNAME);

    // Test POST /auth/logout
    const logoutRes = await app.handle(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: `session=${sessionId}`,
        },
      })
    );
    expect(logoutRes.status).toBe(200);

    // After logout, GET /auth/me should return 401
    const postLogoutMe = await app.handle(
      new Request('http://localhost/api/v1/auth/me', {
        headers: {
          Cookie: `session=${sessionId}`,
        },
      })
    );
    expect(postLogoutMe.status).toBe(401);
  });

  it('rejects unauthenticated requests to protected routes with 401', async () => {
    const res = await app.handle(new Request('http://localhost/api/v1/auth/protected-test'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('formats schema validation errors into standard ApiErrorResponse envelope', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Missing username & password
      })
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBeDefined();
  });
});
