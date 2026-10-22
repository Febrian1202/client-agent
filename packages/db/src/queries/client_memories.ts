import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { clientMemories, type ClientMemoryRow } from '../schema';

export interface InsertClientMemoryInput {
  clientId: number;
  type: string;
  category: string;
  content: string;
  source?: string;
  confidence?: string;
}

export async function insertClientMemory(input: InsertClientMemoryInput): Promise<ClientMemoryRow> {
  const rows = await db
    .insert(clientMemories)
    .values({
      clientId: input.clientId,
      type: input.type,
      category: input.category,
      content: input.content,
      source: input.source ?? 'user_note',
      confidence: input.confidence ?? 'high',
    })
    .returning();
  return rows[0]!;
}

export async function getClientMemoryById(id: number): Promise<ClientMemoryRow | null> {
  const rows = await db
    .select()
    .from(clientMemories)
    .where(eq(clientMemories.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listClientMemories(clientId: number, type?: string): Promise<ClientMemoryRow[]> {
  const conditions = [eq(clientMemories.clientId, clientId)];
  if (type) {
    conditions.push(eq(clientMemories.type, type));
  }

  return db
    .select()
    .from(clientMemories)
    .where(and(...conditions))
    .orderBy(desc(clientMemories.createdAt));
}

export async function updateClientMemory(id: number, content: string): Promise<ClientMemoryRow | null> {
  const rows = await db
    .update(clientMemories)
    .set({
      content,
      updatedAt: sql`now()`,
    })
    .where(eq(clientMemories.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteClientMemory(id: number): Promise<boolean> {
  const rows = await db
    .delete(clientMemories)
    .where(eq(clientMemories.id, id))
    .returning();
  return rows.length > 0;
}
