import { and, desc, eq, sql } from 'drizzle-orm';
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

export const insertConversation = upsertConversation;

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

export interface ListConversationsFilter {
  platform?: string;
  clientId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationWithClientListItem extends ConversationRow {
  clientUsername?: string;
  clientDisplayName?: string | null;
  clientAvatarUrl?: string | null;
  client?: {
    id: number;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export async function listConversations(filter?: ListConversationsFilter): Promise<ConversationWithClientListItem[]> {
  const conditions = [];
  if (filter?.platform) {
    conditions.push(eq(conversations.platform, filter.platform));
  }
  if (filter?.clientId) {
    conditions.push(eq(conversations.clientId, filter.clientId));
  }
  if (filter?.status) {
    conditions.push(eq(conversations.status, filter.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db
    .select({
      conversation: conversations,
      clientUsername: clients.username,
      clientDisplayName: clients.displayName,
      clientAvatarUrl: clients.avatarUrl,
    })
    .from(conversations)
    .innerJoin(clients, eq(conversations.clientId, clients.id))
    .orderBy(desc(conversations.updatedAt));

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }
  if (filter?.limit !== undefined) {
    query = query.limit(filter.limit) as typeof query;
  }
  if (filter?.offset !== undefined) {
    query = query.offset(filter.offset) as typeof query;
  }

  const rows = await query;
  return rows.map((r) => ({
    ...r.conversation,
    clientUsername: r.clientUsername,
    clientDisplayName: r.clientDisplayName,
    clientAvatarUrl: r.clientAvatarUrl,
    client: {
      id: r.conversation.clientId,
      username: r.clientUsername,
      displayName: r.clientDisplayName,
      avatarUrl: r.clientAvatarUrl,
    },
  }));
}
