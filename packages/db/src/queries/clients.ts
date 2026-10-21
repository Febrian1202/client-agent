import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { clients, type ClientRow } from '../schema';

export interface UpsertClientInput {
  userId: number;
  platform: string;
  username: string;
  displayName?: string | null;
}

export interface ListClientsFilter {
  search?: string;
  userId?: number;
  platform?: string;
  limit?: number;
  offset?: number;
}

export async function upsertClient(input: UpsertClientInput): Promise<ClientRow> {
  const rows = await db
    .insert(clients)
    .values({
      userId: input.userId,
      platform: input.platform,
      username: input.username,
      displayName: input.displayName ?? null,
    })
    .onConflictDoUpdate({
      target: [clients.userId, clients.platform, clients.username],
      set: { lastSeenAt: sql`now()`, updatedAt: sql`now()` },
    })
    .returning();
  return rows[0]!;
}

export const insertClient = upsertClient;

export async function getClientByUsername(userId: number, platform: string, username: string): Promise<ClientRow | null> {
  const rows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.platform, platform), eq(clients.username, username)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getClientById(id: number): Promise<ClientRow | null> {
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listClients(filter?: ListClientsFilter): Promise<ClientRow[]> {
  const conditions = [];

  if (filter?.userId) {
    conditions.push(eq(clients.userId, filter.userId));
  }
  if (filter?.platform) {
    conditions.push(eq(clients.platform, filter.platform));
  }
  if (filter?.search) {
    const term = `%${filter.search}%`;
    conditions.push(or(ilike(clients.username, term), ilike(clients.displayName, term)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db.select().from(clients).orderBy(desc(clients.lastSeenAt));

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }
  if (filter?.limit !== undefined) {
    query = query.limit(filter.limit) as typeof query;
  }
  if (filter?.offset !== undefined) {
    query = query.offset(filter.offset) as typeof query;
  }

  return await query;
}
