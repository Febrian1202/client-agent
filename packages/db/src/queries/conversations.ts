import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { clients, conversations, type ConversationRow } from '../schema';

export interface UpsertConversationInput {
  clientId: number;
  platform: string;
  externalId: string;
  externalUrl?: string | null;
}

export async function upsertConversation(input: UpsertConversationInput): Promise<ConversationRow> {
  const rows = await db
    .insert(conversations)
    .values({
      clientId: input.clientId,
      platform: input.platform,
      externalId: input.externalId,
      externalUrl: input.externalUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [conversations.platform, conversations.externalId],
      set: { externalUrl: input.externalUrl ?? null, status: 'active', updatedAt: sql`now()` },
    })
    .returning();
  return rows[0]!;
}

export async function findConversationByExternalId(platform: string, externalId: string): Promise<ConversationRow | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.platform, platform), eq(conversations.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getConversationById(id: number): Promise<ConversationRow | null> {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getConversationByClientId(clientId: number): Promise<ConversationRow | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

export async function touchConversationLastSynced(id: number): Promise<void> {
  const rows = await db
    .update(conversations)
    .set({ lastSyncedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(conversations.id, id))
    .returning();
  if (!rows[0]) {
    throw new Error(`Conversation ${id} not found`);
  }
}

export interface ConversationWithClient {
  conversation: ConversationRow;
  clientId: number;
  clientUsername: string;
}

export async function getConversationWithClient(id: number): Promise<ConversationWithClient | null> {
  const rows = await db
    .select({
      conversation: conversations,
      clientId: clients.id,
      clientUsername: clients.username,
    })
    .from(conversations)
    .innerJoin(clients, eq(conversations.clientId, clients.id))
    .where(eq(conversations.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    conversation: row.conversation,
    clientId: row.clientId,
    clientUsername: row.clientUsername,
  };
}
