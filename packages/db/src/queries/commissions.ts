import { and, desc, eq, sql } from 'drizzle-orm';
import { CommissionStatus } from '@client-agent/domain';
import { db } from '../client';
import { clients, commissions, type CommissionRow, type InsertCommissionRow } from '../schema';

export interface UpsertCommissionInput {
  id?: number;
  clientId: number;
  externalId?: string | null;
  serviceName: string;
  amount: string;
  currency?: string;
  estimatedStart?: string | null;
  guaranteedDelivery?: string | null;
  status?: CommissionStatus | string;
  metadata?: Record<string, unknown>;
}

export interface ListCommissionsFilter {
  status?: CommissionStatus | string;
  clientId?: number;
  limit?: number;
  offset?: number;
}

export interface CommissionListItem extends CommissionRow {
  clientUsername?: string;
  clientDisplayName?: string | null;
  clientAvatarUrl?: string | null;
}

export async function getCommissionById(id: number): Promise<CommissionRow | null> {
  const rows = await db
    .select()
    .from(commissions)
    .where(eq(commissions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateCommission(
  id: number,
  data: Partial<InsertCommissionRow>
): Promise<CommissionRow | null> {
  const rows = await db
    .update(commissions)
    .set({
      ...data,
      updatedAt: sql`now()`,
    })
    .where(eq(commissions.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function upsertCommission(input: UpsertCommissionInput): Promise<CommissionRow> {
  if (input.id) {
    const updateData: Partial<InsertCommissionRow> = {};
    if (input.clientId !== undefined) updateData.clientId = input.clientId;
    if (input.externalId !== undefined) updateData.externalId = input.externalId;
    if (input.serviceName !== undefined) updateData.serviceName = input.serviceName;
    if (input.amount !== undefined) updateData.amount = input.amount;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.estimatedStart !== undefined) updateData.estimatedStart = input.estimatedStart;
    if (input.guaranteedDelivery !== undefined) updateData.guaranteedDelivery = input.guaranteedDelivery;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.metadata !== undefined) updateData.metadata = input.metadata;

    const updated = await updateCommission(input.id, updateData);
    if (updated) {
      return updated;
    }
  }

  if (input.externalId) {
    const conflictUpdateSet: Partial<InsertCommissionRow> & { updatedAt: ReturnType<typeof sql> } = {
      updatedAt: sql`now()`,
    };
    if (input.clientId !== undefined) conflictUpdateSet.clientId = input.clientId;
    if (input.serviceName !== undefined) conflictUpdateSet.serviceName = input.serviceName;
    if (input.amount !== undefined) conflictUpdateSet.amount = input.amount;
    if (input.currency !== undefined) conflictUpdateSet.currency = input.currency;
    if (input.estimatedStart !== undefined) conflictUpdateSet.estimatedStart = input.estimatedStart;
    if (input.guaranteedDelivery !== undefined) conflictUpdateSet.guaranteedDelivery = input.guaranteedDelivery;
    if (input.status !== undefined) conflictUpdateSet.status = input.status;
    if (input.metadata !== undefined) conflictUpdateSet.metadata = input.metadata;

    const rows = await db
      .insert(commissions)
      .values({
        clientId: input.clientId,
        externalId: input.externalId,
        serviceName: input.serviceName,
        amount: input.amount,
        currency: input.currency ?? 'USD',
        estimatedStart: input.estimatedStart ?? null,
        guaranteedDelivery: input.guaranteedDelivery ?? null,
        status: input.status ?? CommissionStatus.REQUESTED,
        metadata: input.metadata ?? {},
      })
      .onConflictDoUpdate({
        target: commissions.externalId,
        set: conflictUpdateSet,
      })
      .returning();
    return rows[0]!;
  }

  const rows = await db
    .insert(commissions)
    .values({
      clientId: input.clientId,
      externalId: null,
      serviceName: input.serviceName,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      estimatedStart: input.estimatedStart ?? null,
      guaranteedDelivery: input.guaranteedDelivery ?? null,
      status: input.status ?? CommissionStatus.REQUESTED,
      metadata: input.metadata ?? {},
    })
    .returning();
  return rows[0]!;
}

export async function listCommissions(filter?: ListCommissionsFilter): Promise<CommissionListItem[]> {
  const conditions = [];
  if (filter?.status) {
    conditions.push(eq(commissions.status, filter.status));
  }
  if (filter?.clientId) {
    conditions.push(eq(commissions.clientId, filter.clientId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db
    .select({
      commission: commissions,
      clientUsername: clients.username,
      clientDisplayName: clients.displayName,
      clientAvatarUrl: clients.avatarUrl,
    })
    .from(commissions)
    .leftJoin(clients, eq(commissions.clientId, clients.id))
    .orderBy(desc(commissions.createdAt));

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
    ...r.commission,
    clientUsername: r.clientUsername ?? undefined,
    clientDisplayName: r.clientDisplayName ?? undefined,
    clientAvatarUrl: r.clientAvatarUrl ?? undefined,
  }));
}
