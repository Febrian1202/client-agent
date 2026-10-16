import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { integrations, type IntegrationRow } from '../schema';

export interface UpsertIntegrationInput {
  userId: number;
  provider: string;
  status: string;
  credentialsEncrypted?: string | null;
  metadata?: Record<string, unknown>;
}

export async function upsertIntegration(input: UpsertIntegrationInput): Promise<IntegrationRow> {
  const rows = await db
    .insert(integrations)
    .values({
      userId: input.userId,
      provider: input.provider,
      status: input.status,
      credentialsEncrypted: input.credentialsEncrypted ?? null,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: {
        status: input.status,
        credentialsEncrypted: input.credentialsEncrypted ?? null,
        metadata: input.metadata ?? {},
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return rows[0]!;
}

export async function getIntegration(userId: number, provider: string): Promise<IntegrationRow | null> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteIntegration(userId: number, provider: string): Promise<void> {
  await db.delete(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)));
}
