import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, events, agentTasks, integrations, getOwnerUserId, upsertIntegration, deleteIntegration } from '@client-agent/db';
import { TaskType, VGenEventType } from '@client-agent/domain';
import { GmailApiError, GmailHistoryExpiredError, PubSubAuthError, type GmailClient } from '@client-agent/gmail';
import { createGmailWebhookRoutes } from '../src/routes/webhooks/gmail';

const ownerId = await getOwnerUserId();
const externalId = `wh-${Date.now()}`;
const historyId = '5000';
const pushBody = (id: string) => ({
  message: { data: Buffer.from(JSON.stringify({ emailAddress: 'me@example.com', historyId: id })).toString('base64') },
});

function fakeClient(overrides: Partial<GmailClient> = {}): GmailClient {
  return {
    getProfile: async () => ({ emailAddress: 'me@example.com', historyId: '4000' }),
    listHistory: async () => ({ messageIds: [externalId], latestHistoryId: historyId }),
    fetchMessageById: async (id) => ({
      id, threadId: 'th', subject: '@ErianOsamu sent you a new message!',
      from: 'VGen <no-reply@vgen.co>', date: '2026-10-16T14:32:11.000Z',
    }),
    ...overrides,
  };
}

const appWith = (client: GmailClient) => new Elysia().use(createGmailWebhookRoutes({ resolveGmailClient: async () => client, audience: null }));

const post = (app: { handle: (request: Request) => Promise<Response> }, body: unknown) => app.handle(new Request('http://localhost/api/v1/webhooks/google/gmail', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(async () => {
  const existing = await db.select().from(events).where(eq(events.externalId, externalId));
  for (const event of existing) {
    await db.delete(agentTasks).where(eq(agentTasks.eventId, event.id));
  }
  await db.delete(events).where(eq(events.externalId, externalId));
});

afterAll(async () => {
  await db.delete(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${externalId}:process`));
  await db.delete(events).where(eq(events.externalId, externalId));
  await deleteIntegration(ownerId, 'gmail');
});

describe('POST /api/v1/webhooks/google/gmail', () => {
  it('creates exactly one event and one task when the same push arrives twice', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });
    const app = appWith(fakeClient());
    expect((await post(app, pushBody(historyId))).status).toBe(200);
    expect((await post(app, pushBody(historyId))).status).toBe(200);
    const rows = await db.select().from(events).where(eq(events.externalId, externalId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe(VGenEventType.NEW_MESSAGE);
    expect(rows[0]!.payload).toMatchObject({ clientUsername: 'ErianOsamu' });
    const tasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${rows[0]!.id}:process`));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe(TaskType.PROCESS_GMAIL_EVENT);
  });

  it('returns 400 for a malformed Pub/Sub envelope', async () => {
    const res = await post(appWith(fakeClient()), { message: { data: 'nope' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_PUBSUB_PAYLOAD');
  });

  it('bootstraps the history id when the integration has none', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: {} });
    const res = await post(appWith(fakeClient()), pushBody(historyId));
    expect(await res.json()).toEqual({ ok: true, bootstrapped: true });
  });

  it('re-bootstraps when the stored history id has expired', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: '1' } });
    const client = fakeClient({ listHistory: async () => { throw new GmailHistoryExpiredError('too old'); } });
    expect(await (await post(appWith(client), pushBody(historyId))).json()).toEqual({ ok: true, bootstrapped: true });
  });

  it('answers 200 and marks the integration on a revoked credential', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });
    const client = fakeClient({ listHistory: async () => { throw new GmailApiError(401, 'invalid_grant'); } });
    const res = await post(appWith(client), pushBody(historyId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'gmail_api_error' });
    expect((await db.select().from(integrations).where(eq(integrations.provider, 'gmail')))[0]!.status).toBe('error');
  });

  it('reports gmail_not_connected instead of failing when no integration exists', async () => {
    await deleteIntegration(ownerId, 'gmail');
    expect(await (await post(appWith(fakeClient()), pushBody(historyId))).json()).toEqual({ ok: false, reason: 'gmail_not_connected' });
  });

  it('rejects an unverifiable push when an audience is configured', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });
    const app = new Elysia().use(createGmailWebhookRoutes({
      resolveGmailClient: async () => fakeClient(),
      audience: 'https://agent.example.com/api/v1/webhooks/google/gmail',
      verifyToken: async () => { throw new PubSubAuthError('bad token'); },
    }));
    const res = await post(app, pushBody(historyId));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    expect(await db.select().from(events).where(eq(events.externalId, externalId))).toHaveLength(0);
  });
});
