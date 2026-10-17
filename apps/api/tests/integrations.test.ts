import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { config } from '@client-agent/config';
import { getOwnerUserId, getIntegration, deleteIntegration, upsertIntegration } from '@client-agent/db';
import { app } from '../src/app';
import { createIntegrationRoutes, type IntegrationDeps } from '../src/routes/integrations';

const ownerId = await getOwnerUserId();
const refreshToken = `1//refresh-${Date.now()}`;

const deps: IntegrationDeps = {
  verifyGmailRefreshToken: async (token) => {
    if (token !== refreshToken) throw new Error('invalid_grant');
    return { emailAddress: 'creator@example.com', historyId: '7777' };
  },
  verifyDiscordChannel: async (channelId) => {
    if (channelId !== 'chan-ok') throw new Error('Unknown Channel');
    return { id: channelId, name: 'vgen-alerts' };
  },
};

// isAuth validates the cookie against Redis, so the suite logs in once and reuses the real session.
let sessionCookie = '';
let originalDiscord: Awaited<ReturnType<typeof getIntegration>> = null;
let originalGmail: Awaited<ReturnType<typeof getIntegration>> = null;

beforeAll(async () => {
  originalDiscord = await getIntegration(ownerId, 'discord');
  originalGmail = await getIntegration(ownerId, 'gmail');
  await deleteIntegration(ownerId, 'gmail');
  await deleteIntegration(ownerId, 'discord');

  const res = await app.handle(new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.AUTH_USERNAME, password: 'admin123' }),
  }));
  sessionCookie = res.headers.get('set-cookie')!.match(/session=([^;]+)/)![1]!;
});

afterAll(async () => {
  await deleteIntegration(ownerId, 'gmail');
  await deleteIntegration(ownerId, 'discord');
  if (originalDiscord) {
    await upsertIntegration({
      userId: ownerId,
      provider: 'discord',
      status: originalDiscord.status,
      metadata: (originalDiscord.metadata ?? {}) as Record<string, unknown>,
    });
  }
  if (originalGmail) {
    await upsertIntegration({
      userId: ownerId,
      provider: 'gmail',
      status: originalGmail.status,
      credentialsEncrypted: originalGmail.credentialsEncrypted,
      metadata: (originalGmail.metadata ?? {}) as Record<string, unknown>,
    });
  }
});

const routes = new Elysia().use(createIntegrationRoutes(deps));
const call = (path: string, method = 'GET', body?: unknown) => routes.handle(new Request(`http://localhost/api/v1/integrations${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', Cookie: `session=${sessionCookie}` },
  body: body ? JSON.stringify(body) : undefined,
}));

describe('Integration management API', () => {
  it('requires a session', async () => {
    const res = await routes.handle(new Request('http://localhost/api/v1/integrations'));
    expect(res.status).toBe(401);
  });

  it('reports gmail and discord as disconnected when nothing is configured', async () => {
    const body = await (await call('/', 'GET')).json();
    expect(body.data).toEqual([
      { provider: 'gmail', status: 'disconnected', connected: false, metadata: {} },
      { provider: 'discord', status: 'disconnected', connected: false, metadata: {} },
    ]);
  });

  it('stores gmail credentials sealed and reports the account', async () => {
    const res = await call('/gmail', 'POST', { refreshToken });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ provider: 'gmail', status: 'connected', emailAddress: 'creator@example.com' });
    const row = await getIntegration(ownerId, 'gmail');
    expect(row!.credentialsEncrypted!.startsWith('v1.')).toBeTrue();
    expect(row!.credentialsEncrypted!).not.toContain(refreshToken);
    expect(row!.metadata).toMatchObject({ emailAddress: 'creator@example.com', lastHistoryId: '7777' });
  });

  it('rejects a bad refresh token without storing anything', async () => {
    await deleteIntegration(ownerId, 'gmail');
    const res = await call('/gmail', 'POST', { refreshToken: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('GMAIL_AUTH_FAILED');
    expect(await getIntegration(ownerId, 'gmail')).toBeNull();
  });

  it('never leaks sealed credentials through GET', async () => {
    await call('/gmail', 'POST', { refreshToken });
    expect(JSON.stringify(await (await call('/', 'GET')).json())).not.toContain('v1.');
  });

  it('clears credentials on DELETE', async () => {
    await call('/gmail', 'POST', { refreshToken });
    expect((await call('/gmail', 'DELETE')).status).toBe(200);
    expect(await getIntegration(ownerId, 'gmail')).toBeNull();
  });

  it('verifies a discord channel before storing it', async () => {
    expect((await call('/discord', 'POST', { channelId: 'chan-bad' })).status).toBe(400);
    await expect((await call('/discord', 'POST', { channelId: 'chan-bad' })).json()).resolves.toMatchObject({ error: { code: 'DISCORD_AUTH_FAILED' } });
    const res = await call('/discord', 'POST', { channelId: 'chan-ok' });
    expect(res.status).toBe(200);
    expect((await getIntegration(ownerId, 'discord'))!.metadata).toMatchObject({ channelId: 'chan-ok', channelName: 'vgen-alerts' });
    expect((await call('/discord', 'DELETE')).status).toBe(200);
  });
});
