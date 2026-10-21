import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { auditLogs, type AuditLogRow } from '../schema';

export interface InsertAuditLogInput {
  userId?: number | null;
  actorType: 'user' | 'agent' | 'system';
  actorId?: number | null;
  action: string;
  targetType: string;
  targetId: number;
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogsFilter {
  limit?: number;
  offset?: number;
  actorType?: string;
  targetType?: string;
  userId?: number;
}

export async function insertAuditLog(input: InsertAuditLogInput): Promise<AuditLogRow> {
  const rows = await db
    .insert(auditLogs)
    .values({
      userId: input.userId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    })
    .returning();
  return rows[0]!;
}

export async function listAuditLogs(filter?: ListAuditLogsFilter): Promise<AuditLogRow[]> {
  const conditions = [];
  if (filter?.actorType) {
    conditions.push(eq(auditLogs.actorType, filter.actorType));
  }
  if (filter?.targetType) {
    conditions.push(eq(auditLogs.targetType, filter.targetType));
  }
  if (filter?.userId) {
    conditions.push(eq(auditLogs.userId, filter.userId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));

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
