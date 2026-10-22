import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  db,
  getOwnerUserId,
  insertClient,
  insertClientMemory,
  getClientMemoryById,
  listClientMemories,
  updateClientMemory,
  deleteClientMemory,
  clients,
  clientMemories,
} from '../src';
import { eq } from 'drizzle-orm';

describe('Client Memories Database Queries', () => {
  const suffix = Date.now();
  let ownerUserId: number;
  let testClientId: number;

  beforeAll(async () => {
    ownerUserId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerUserId,
      platform: 'vgen',
      username: `mem_user_${suffix}`,
      displayName: `Memory Test User ${suffix}`,
    });
    testClientId = client.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, testClientId));
  });

  it('inserts and retrieves a client memory', async () => {
    const memory = await insertClientMemory({
      clientId: testClientId,
      type: 'fact',
      category: 'technical',
      content: 'Uses VTube Studio on iOS tracking',
      source: 'user_note',
      confidence: 'high',
    });

    expect(memory.id).toBeDefined();
    expect(memory.clientId).toBe(testClientId);
    expect(memory.type).toBe('fact');
    expect(memory.category).toBe('technical');
    expect(memory.content).toBe('Uses VTube Studio on iOS tracking');

    const fetched = await getClientMemoryById(memory.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.content).toBe(memory.content);
  });

  it('lists memories filtered by client ID and type', async () => {
    await insertClientMemory({
      clientId: testClientId,
      type: 'preference',
      category: 'scope',
      content: 'Prefers milestone review for head before physics',
    });

    const all = await listClientMemories(testClientId);
    expect(all.length).toBeGreaterThanOrEqual(2);

    const preferencesOnly = await listClientMemories(testClientId, 'preference');
    expect(preferencesOnly.every((m) => m.type === 'preference')).toBe(true);
  });

  it('updates memory content and updates timestamp', async () => {
    const memory = await insertClientMemory({
      clientId: testClientId,
      type: 'fact',
      category: 'assets',
      content: 'PSD link: v1',
    });

    const updated = await updateClientMemory(memory.id, 'PSD link: v2 final');
    expect(updated?.content).toBe('PSD link: v2 final');
  });

  it('deletes a memory by id', async () => {
    const memory = await insertClientMemory({
      clientId: testClientId,
      type: 'inference',
      category: 'general',
      content: 'May need commercial rights',
    });

    const success = await deleteClientMemory(memory.id);
    expect(success).toBe(true);

    const check = await getClientMemoryById(memory.id);
    expect(check).toBeNull();
  });

  it('cascades delete when parent client is removed', async () => {
    const tempClient = await insertClient({
      userId: ownerUserId,
      platform: 'vgen',
      username: `cascade_user_${suffix}`,
    });
    const mem = await insertClientMemory({
      clientId: tempClient.id,
      type: 'fact',
      category: 'general',
      content: 'Will be deleted with client',
    });

    await db.delete(clients).where(eq(clients.id, tempClient.id));
    const check = await getClientMemoryById(mem.id);
    expect(check).toBeNull();
  });
});
