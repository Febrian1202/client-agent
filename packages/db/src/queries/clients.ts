import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { clients, type ClientRow } from '../schema';

export interface UpsertClientInput {
  userId: number;
  platform: string;
  username: string;
  displayName?: string | null;
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
