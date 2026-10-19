import { and, desc, eq, sql } from 'drizzle-orm';
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
