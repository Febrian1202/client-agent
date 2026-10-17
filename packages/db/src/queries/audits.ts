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
