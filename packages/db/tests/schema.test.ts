import { describe, expect, it, afterAll } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db, users } from '../src/index';
import { clients, events, agentTasks, integrations } from '../src/schema';
import { VGenEventType, TaskType } from '@client-agent/domain';

const ownerId = async () => {
  const rows = await db.select().from(users).orderBy(sql`id asc`).limit(1);
  if (rows[0]) return rows[0].id;
  const inserted = await db.insert(users).values({ name: 'schema-test', email: 'schema-test@localhost' }).returning();
  return inserted[0]!.id;
};

// Cleanup deletes only the rows this file created, by id, so a concurrent suite is never touched.
const createdIds: { events: number[]; clients: number[]; agentTasks: number[]; integrations: number[] } = {
  events: [], clients: [], agentTasks: [], integrations: [],
};

afterAll(async () => {
  for (const id of createdIds.agentTasks) await db.delete(agentTasks).where(eq(agentTasks.id, id));
  for (const id of createdIds.events) await db.delete(events).where(eq(events.id, id));
  for (const id of createdIds.clients) await db.delete(clients).where(eq(clients.id, id));
  for (const id of createdIds.integrations) await db.delete(integrations).where(eq(integrations.id, id));
});

describe('Phase 1 schema', () => {
  it('rejects a duplicate events.external_id (dedup anchor)', async () => {
    const row = { source: 'schema-test', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE, externalId: `schema-dup-${Date.now()}` };
    const first = await db.insert(events).values(row).returning();
    createdIds.events.push(first[0]!.id);
    await expect(db.insert(events).values(row).execute()).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects a duplicate (user_id, platform, username) client', async () => {
    const userId = await ownerId();
    const row = { userId, platform: 'vgen', username: `SchemaTestUser${Date.now()}` };
    const first = await db.insert(clients).values(row).returning();
    createdIds.clients.push(first[0]!.id);
    await expect(db.insert(clients).values(row).execute()).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects a duplicate (user_id, provider) integration', async () => {
    const userId = await ownerId();
    const row = { userId, provider: `schema-test-${Date.now()}` };
    const first = await db.insert(integrations).values(row).returning();
    createdIds.integrations.push(first[0]!.id);
    await expect(db.insert(integrations).values(row).execute()).rejects.toThrow(/duplicate key|unique/i);
  });

  it('defaults agent_tasks to queued with attempts 0 and max_attempts 5', async () => {
    const userId = await ownerId();
    const inserted = await db.insert(agentTasks).values({ userId, type: TaskType.PROCESS_GMAIL_EVENT, input: {} }).returning();
    createdIds.agentTasks.push(inserted[0]!.id);
    expect(inserted[0]!.status as string).toBe('queued');
    expect(inserted[0]!.attempts).toBe(0);
    expect(inserted[0]!.maxAttempts).toBe(5);
    expect(inserted[0]!.startedAt).toBeNull();
  });

  it('defaults events to received with received_at set', async () => {
    const inserted = await db.insert(events).values({
      source: 'schema-test', provider: 'vgen', eventType: VGenEventType.UNKNOWN, externalId: `schema-default-${Date.now()}`,
    }).returning();
    createdIds.events.push(inserted[0]!.id);
    expect(inserted[0]!.status as string).toBe('received');
    expect(inserted[0]!.receivedAt).toBeInstanceOf(Date);
    expect(inserted[0]!.processedAt).toBeNull();
  });
});
