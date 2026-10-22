import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  db,
  getOwnerUserId,
  insertClient,
  clients,
  clientMemories,
} from '@client-agent/db';
import { app } from '../src/app';
import { createSession } from '../src/auth/session';
import { eq } from 'drizzle-orm';

describe('Client Memories REST API Endpoints', () => {
  let cookieHeader: string;
  let ownerId: number;
  let testClientId: number;
  let otherClientId: number;
  const suffix = Date.now();

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;

    const clientA = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `mem_api_client_${suffix}`,
    });
    testClientId = clientA.id;

    const clientB = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `other_api_client_${suffix}`,
    });
    otherClientId = clientB.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, testClientId));
    await db.delete(clients).where(eq(clients.id, otherClientId));
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`)
    );
    expect(res.status).toBe(401);
  });

  it('creates a new memory record for a client via POST', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'fact',
          category: 'technical',
          content: 'Model created in Live2D Cubism 5.0',
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.memory.id).toBeDefined();
    expect(body.memory.content).toBe('Model created in Live2D Cubism 5.0');
  });

  it('rejects POST with empty content with 400 Bad Request', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'fact',
          category: 'technical',
          content: '   ',
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('lists client memories with grouped categories via GET', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.memories).toBeInstanceOf(Array);
    expect(body.grouped).toBeDefined();
    expect(body.grouped.facts).toBeInstanceOf(Array);
  });

  it('updates a memory record via PATCH', async () => {
    // First create a memory to patch
    const createRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'preference',
          category: 'scope',
          content: 'Initial preference text',
        }),
      })
    );
    const { memory } = (await createRes.json()) as any;

    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated preference text' }),
      })
    );

    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as any;
    expect(patchBody.memory.content).toBe('Updated preference text');
  });

  it('prevents modifying memory belonging to a different client (cross-client boundary)', async () => {
    // Create memory on client B
    const createRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${otherClientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact',
          category: 'general',
          content: 'Belongs to Client B',
        }),
      })
    );
    const { memory } = (await createRes.json()) as any;

    // Try to update it through Client A's URL path
    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hacked content' }),
      })
    );
    expect(patchRes.status).toBe(404);
  });

  it('deletes a memory record via DELETE', async () => {
    const createRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inference',
          category: 'general',
          content: 'To be deleted',
        }),
      })
    );
    const { memory } = (await createRes.json()) as any;

    const deleteRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories/${memory.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      })
    );
    expect(deleteRes.status).toBe(200);
  });
});
