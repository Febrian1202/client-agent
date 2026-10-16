import { describe, expect, it } from 'bun:test';
import { ApiClient } from '../src/lib/api';

describe('Web App ApiClient', () => {
  it('parses successful health check responses', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ status: 'ready', database: 'ok', redis: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new ApiClient({ fetch: mockFetch });
    const health = await client.getHealth();

    expect(health.status).toBe('ready');
    expect(health.database).toBe('ok');
    expect(health.redis).toBe('ok');
  });

  it('handles login success and extracts user object', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          user: { id: 1, name: 'admin', email: 'admin@localhost' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const user = await client.login('admin', 'admin123');

    expect(user.id).toBe(1);
    expect(user.name).toBe('admin');
  });

  it('throws descriptive error on invalid credentials', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    expect(client.login('admin', 'wrong')).rejects.toThrow('Invalid username or password');
  });

  it('retrieves current logged-in user with getMe', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          user: { id: 1, name: 'admin', email: 'admin@localhost' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const user = await client.getMe();
    expect(user).not.toBeNull();
    expect(user?.name).toBe('admin');
  });

  it('returns null on getMe when unauthenticated', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'No active session' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const user = await client.getMe();
    expect(user).toBeNull();
  });
});
