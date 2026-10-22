import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  db,
  getOwnerUserId,
  insertClient,
  getClientById,
  clients,
  clientMemories,
} from '@client-agent/db';
import { app } from '../apps/api/src/app';
import { createSession } from '../apps/api/src/auth/session';
import { eq } from 'drizzle-orm';
import { buildReplyPrompt } from '@client-agent/agent';

describe('Phase 8 — Client Memory End-to-End Integration Suite', () => {
  let cookieHeader: string;
  let ownerId: number;
  let clientId: number;
  const suffix = Date.now();

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;

    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `e2e_client_mem_${suffix}`,
      displayName: `E2E Memory Client ${suffix}`,
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId));
  });

  it('1. Adds verified technical facts and rigging scope preferences via REST API', async () => {
    // Add technical fact
    const factRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact',
          category: 'technical',
          content: 'Model rig target: VTube Studio iOS tracking, Cubism 5.0',
        }),
      })
    );
    expect(factRes.status).toBe(201);

    // Add scope preference
    const prefRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'preference',
          category: 'scope',
          content: 'Prefers separate approval for eye physics and mouth tracking',
        }),
      })
    );
    expect(prefRes.status).toBe(201);

    // Add inference
    const infRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inference',
          category: 'general',
          content: 'Might debut within 3 weeks',
        }),
      })
    );
    expect(infRes.status).toBe(201);
  });

  it('2. Retrieves memories grouped by type through API', async () => {
    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as any;
    expect(body.grouped.facts.length).toBe(1);
    expect(body.grouped.preferences.length).toBe(1);
    expect(body.grouped.inferences.length).toBe(1);
  });

  it('3. Injects memories into Agent Prompt with strict epistemic segregation', async () => {
    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    const { memories } = (await listRes.json()) as any;

    const promptMessages = buildReplyPrompt(
      {
        clientUsername: `e2e_client_mem_${suffix}`,
        messages: [
          {
            direction: 'inbound',
            senderName: 'Client',
            content: 'How is the tracking setup coming along?',
            sentAt: new Date(),
          },
        ],
        memories,
      },
      'Tell them progress is smooth'
    );

    const userPrompt = promptMessages.find((m) => m.role === 'user')?.content ?? '';
    const systemPrompt = promptMessages.find((m) => m.role === 'system')?.content ?? '';

    // Verify fact is under [VERIFIED FACTS]
    expect(userPrompt).toContain('[VERIFIED FACTS]');
    expect(userPrompt).toContain('VTube Studio iOS tracking');

    // Verify preference is under [KNOWN PREFERENCES]
    expect(userPrompt).toContain('[KNOWN PREFERENCES]');
    expect(userPrompt).toContain('eye physics and mouth tracking');

    // Verify inference has warning header and is never presented as fact
    expect(userPrompt).toContain('[AI INFERENCES - NOT VERIFIED FACTS]');
    expect(userPrompt).toContain('Never assume as established fact');
    expect(systemPrompt).toContain('NEVER state an unverified inference as a confirmed fact');
  });

  it('4. Updates memory content via API and verifies persistence', async () => {
    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    const { memories } = (await listRes.json()) as any;
    const target = memories[0];

    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories/${target.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated rig target: Cubism 5.0 with VBridger parameters' }),
      })
    );
    expect(patchRes.status).toBe(200);

    const verifyRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    const verifyBody = (await verifyRes.json()) as any;
    const updated = verifyBody.memories.find((m: any) => m.id === target.id);
    expect(updated.content).toContain('VBridger parameters');
  });

  it('5. Deletes client and verifies cascade deletion of all memories', async () => {
    await db.delete(clients).where(eq(clients.id, clientId));

    const checkMemories = await db
      .select()
      .from(clientMemories)
      .where(eq(clientMemories.clientId, clientId));

    expect(checkMemories.length).toBe(0);
  });
});
