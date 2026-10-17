import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  clients,
  conversations,
  getOwnerUserId,
  upsertClient,
  upsertConversation,
} from '@client-agent/db';
import { TaskType } from '@client-agent/domain';
import { STREAMS } from '@client-agent/queue';
import { app } from '../src/app';
import { createSession } from '../src/auth/session';
import { createConversationRoutes, type ConversationRoutesDeps } from '../src/routes/conversations';
import { getStreamForTaskType } from '../src/routes/tasks';

describe('Conversation sync API endpoints', () => {
  const createdTaskIds: number[] = [];
  const seededClientUsernames: string[] = [];
  const seededConversationIds: number[] = [];
  let cookieHeader: string;
  let ownerId: number;

  const publisherCalls: Array<{ stream: string; payload: Record<string, unknown> }> = [];
  const deps: ConversationRoutesDeps = {
    publishTask: async (stream, payload) => {
      publisherCalls.push({ stream, payload });
      return 'stubbed-id';
    },
  };
  const routes = new Elysia().use(createConversationRoutes(deps));
  const call = (path: string, body?: unknown) =>
    routes.handle(
      new Request(`http://localhost/api/v1/conversations${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    );

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;
  });

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
    for (const id of seededConversationIds) {
      await db.delete(conversations).where(eq(conversations.id, id));
    }
    for (const username of seededClientUsernames) {
      await db.delete(clients).where(eq(clients.username, username));
    }
  });

  it('POST /sync queues a READ_VGEN_CONVERSATION task on the browser stream', async () => {
    const res = await call('/sync', { username: 'ErianOsamu' });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.taskId).toBeString();
    expect(body.status).toBe('queued');

    createdTaskIds.push(Number(body.taskId));
    const task = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, Number(body.taskId)))
      .limit(1);
    expect(task[0]!.type).toBe(TaskType.READ_VGEN_CONVERSATION);
    expect(task[0]!.idempotencyKey!.startsWith('read_vgen:')).toBeTrue();
    expect(task[0]!.input).toMatchObject({
      clientUsername: 'ErianOsamu',
      requestedBy: 'api',
    });

    expect(publisherCalls.at(-1)!.stream).toBe(STREAMS.BROWSER);
    expect(publisherCalls.at(-1)!.payload).toMatchObject({
      type: TaskType.READ_VGEN_CONVERSATION,
      taskId: body.taskId,
    });
  });

  it('POST /sync requires authentication', async () => {
    const res = await routes.handle(
      new Request('http://localhost/api/v1/conversations/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ErianOsamu' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('POST /sync validates username with TypeBox', async () => {
    const res = await call('/sync', { username: '' });
    expect(res.status).toBe(422);
  });

  it('POST /:id/sync queues a SYNC_CONVERSATION task for a seeded conversation', async () => {
    seededClientUsernames.push('TestSeededClient');
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: 'TestSeededClient',
    });
    const conversation = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `test-sync-${client.id}`,
    });
    seededConversationIds.push(conversation.id);

    const res = await call(`/${conversation.id}/sync`);
    expect(res.status).toBe(202);
    const body = await res.json();
    createdTaskIds.push(Number(body.taskId));

    const task = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, Number(body.taskId)))
      .limit(1);
    expect(task[0]!.type).toBe(TaskType.SYNC_CONVERSATION);
    expect(task[0]!.idempotencyKey!.startsWith('sync_conversation:')).toBeTrue();
    expect(publisherCalls.at(-1)!.stream).toBe(STREAMS.BROWSER);
    expect(publisherCalls.at(-1)!.payload).toMatchObject({
      type: TaskType.SYNC_CONVERSATION,
      taskId: body.taskId,
    });
  });

  it('POST /:id/sync returns 404 for unknown conversation', async () => {
    const res = await call('/99999999/sync');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('maps SYNC_CONVERSATION to the browser stream (decision #5)', () => {
    expect(getStreamForTaskType(TaskType.SYNC_CONVERSATION)).toBe(STREAMS.BROWSER);
  });
});
