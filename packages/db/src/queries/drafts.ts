import { and, desc, eq, sql } from 'drizzle-orm';
import {
  type Draft,
  type Approval,
  type DraftRepository,
  type CreateDraftInput,
  type UpdateDraftInput,
  type InsertApprovalInput,
  type InsertAuditLogInput as DomainAuditLogInput,
  DraftStatus,
  ApprovalAction,
  ApprovalStatus,
  DraftService,
} from '@client-agent/domain';
import { db } from '../client';
import {
  approvals,
  conversations,
  drafts,
  type ApprovalRow,
  type ConversationRow,
  type DraftRow,
  type InsertApprovalRow,
  type InsertDraftRow,
} from '../schema';
import { insertAuditLog } from './audits';

export interface ListDraftsFilter {
  status?: string;
  conversationId?: number;
  limit?: number;
  offset?: number;
}

export interface DraftWithContext {
  draft: DraftRow;
  conversation: ConversationRow;
  approvals: ApprovalRow[];
}

export async function insertDraft(data: InsertDraftRow): Promise<DraftRow> {
  const rows = await db.insert(drafts).values(data).returning();
  return rows[0]!;
}

export async function getDraftById(id: number): Promise<DraftRow | null> {
  const rows = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listDrafts(filter?: ListDraftsFilter): Promise<DraftRow[]> {
  const conditions = [];
  if (filter?.status) {
    conditions.push(eq(drafts.status, filter.status));
  }
  if (filter?.conversationId) {
    conditions.push(eq(drafts.conversationId, filter.conversationId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db.select().from(drafts).orderBy(desc(drafts.createdAt));

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

export async function updateDraft(id: number, data: Partial<InsertDraftRow>): Promise<DraftRow | null> {
  const rows = await db
    .update(drafts)
    .set({
      ...data,
      updatedAt: sql`now()`,
    })
    .where(eq(drafts.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function insertApproval(data: InsertApprovalRow): Promise<ApprovalRow> {
  const rows = await db.insert(approvals).values(data).returning();
  return rows[0]!;
}

export async function revokeApprovalsForDraft(draftId: number): Promise<void> {
  await db
    .update(approvals)
    .set({
      status: 'revoked',
      updatedAt: sql`now()`,
    })
    .where(and(eq(approvals.draftId, draftId), eq(approvals.status, 'active')));
}

export async function getApprovalsByDraftId(draftId: number): Promise<ApprovalRow[]> {
  return await db
    .select()
    .from(approvals)
    .where(eq(approvals.draftId, draftId))
    .orderBy(desc(approvals.createdAt));
}

export async function getDraftWithContext(id: number): Promise<DraftWithContext | null> {
  const rows = await db
    .select({
      draft: drafts,
      conversation: conversations,
    })
    .from(drafts)
    .innerJoin(conversations, eq(drafts.conversationId, conversations.id))
    .where(eq(drafts.id, id))
    .limit(1);

  if (!rows[0]) return null;

  const activeApprovals = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.draftId, id), eq(approvals.status, 'active')))
    .orderBy(desc(approvals.createdAt));

  return {
    draft: rows[0].draft,
    conversation: rows[0].conversation,
    approvals: activeApprovals,
  };
}

function mapDraftRowToEntity(row: DraftRow): Draft {
  return {
    id: row.id,
    conversationId: row.conversationId,
    agentRunId: row.agentRunId,
    content: row.content,
    status: row.status as DraftStatus,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapApprovalRowToEntity(row: ApprovalRow): Approval {
  return {
    id: row.id,
    draftId: row.draftId,
    userId: row.userId,
    action: row.action as ApprovalAction,
    status: row.status as ApprovalStatus,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDbDraftRepository(): DraftRepository {
  return {
    async getDraftById(id: number): Promise<Draft | null> {
      const row = await getDraftById(id);
      return row ? mapDraftRowToEntity(row) : null;
    },

    async createDraft(data: CreateDraftInput): Promise<Draft> {
      const row = await insertDraft({
        conversationId: data.conversationId,
        content: data.content,
        agentRunId: data.agentRunId ?? null,
        status: data.status ?? DraftStatus.PENDING_APPROVAL,
      });
      return mapDraftRowToEntity(row);
    },

    async updateDraft(id: number, data: UpdateDraftInput): Promise<Draft | null> {
      const updateData: Partial<InsertDraftRow> = {};
      if (data.content !== undefined) updateData.content = data.content;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.approvedBy !== undefined) updateData.approvedBy = data.approvedBy;
      if (data.approvedAt !== undefined) updateData.approvedAt = data.approvedAt;
      if (data.sentAt !== undefined) updateData.sentAt = data.sentAt;

      const row = await updateDraft(id, updateData);
      return row ? mapDraftRowToEntity(row) : null;
    },

    async insertApproval(data: InsertApprovalInput): Promise<Approval> {
      const row = await insertApproval({
        draftId: data.draftId,
        userId: data.userId,
        action: data.action,
        status: data.status,
        contentHash: data.contentHash,
      });
      return mapApprovalRowToEntity(row);
    },

    async revokeApprovalsForDraft(draftId: number): Promise<void> {
      await revokeApprovalsForDraft(draftId);
    },

    async insertAuditLog(log: DomainAuditLogInput): Promise<void> {
      await insertAuditLog({
        userId: log.userId,
        actorType: log.actorType,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata,
      });
    },
  };
}

export const draftService = new DraftService(createDbDraftRepository());

