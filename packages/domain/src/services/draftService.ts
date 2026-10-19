import { createHash } from 'crypto';
import {
  ApprovalAction,
  ApprovalStatus,
  AuditAction,
  DraftStatus,
} from '../enums';
import type { Approval, Draft } from '../entities';

export class DraftNotFoundError extends Error {
  constructor(draftId: number) {
    super(`Draft with ID ${draftId} not found`);
    this.name = 'DraftNotFoundError';
  }
}

export class InvalidDraftStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDraftStateError';
  }
}

export class DraftContentEmptyError extends Error {
  constructor(message: string = 'Draft content cannot be empty') {
    super(message);
    this.name = 'DraftContentEmptyError';
  }
}

export interface CreateDraftInput {
  conversationId: number;
  content: string;
  agentRunId?: number | null;
  status?: DraftStatus;
}

export interface UpdateDraftInput {
  content?: string;
  status?: DraftStatus;
  approvedBy?: number | null;
  approvedAt?: Date | null;
  sentAt?: Date | null;
}

export interface InsertApprovalInput {
  draftId: number;
  userId: number;
  action: ApprovalAction | 'approve' | 'reject';
  status: ApprovalStatus | 'active' | 'revoked';
  contentHash?: string | null;
}

export interface InsertAuditLogInput {
  userId?: number | null;
  actorType: 'user' | 'agent' | 'system';
  actorId?: number | null;
  action: string;
  targetType: string;
  targetId: number;
  metadata?: Record<string, unknown>;
}

export interface DraftRepository {
  getDraftById(id: number): Promise<Draft | null>;
  createDraft(data: CreateDraftInput): Promise<Draft>;
  updateDraft(id: number, data: UpdateDraftInput): Promise<Draft | null>;
  insertApproval(data: InsertApprovalInput): Promise<Approval>;
  revokeApprovalsForDraft(draftId: number): Promise<void>;
  insertAuditLog(log: InsertAuditLogInput): Promise<void>;
}

export interface CreateDraftParams {
  conversationId: number;
  content: string;
  agentRunId?: number | null;
  userId?: number | null;
}

export interface ApproveDraftParams {
  draftId: number;
  userId: number;
}

export interface RejectDraftParams {
  draftId: number;
  userId: number;
  reason?: string;
}

export interface UpdateDraftContentParams {
  draftId: number;
  newContent: string;
  userId: number;
}

export async function createDraft(repo: DraftRepository, params: CreateDraftParams): Promise<Draft> {
  if (!params.content || !params.content.trim()) {
    throw new DraftContentEmptyError();
  }

  const draft = await repo.createDraft({
    conversationId: params.conversationId,
    content: params.content,
    agentRunId: params.agentRunId ?? null,
    status: DraftStatus.PENDING_APPROVAL,
  });

  if (params.agentRunId) {
    await repo.insertAuditLog({
      actorType: 'agent',
      actorId: params.agentRunId,
      action: AuditAction.AGENT_GENERATED_DRAFT,
      targetType: 'draft',
      targetId: draft.id,
      metadata: { conversationId: params.conversationId },
    });
  } else if (params.userId) {
    await repo.insertAuditLog({
      userId: params.userId,
      actorType: 'user',
      actorId: params.userId,
      action: AuditAction.USER_CREATED_DRAFT,
      targetType: 'draft',
      targetId: draft.id,
      metadata: { conversationId: params.conversationId },
    });
  }

  return draft;
}

export async function approveDraft(repo: DraftRepository, params: ApproveDraftParams): Promise<Draft> {
  const draft = await repo.getDraftById(params.draftId);
  if (!draft) {
    throw new DraftNotFoundError(params.draftId);
  }

  if (draft.status === DraftStatus.SENT) {
    throw new InvalidDraftStateError('Cannot approve draft: draft is already sent');
  }

  if (draft.status !== DraftStatus.PENDING_APPROVAL) {
    throw new InvalidDraftStateError(`Cannot approve draft with status '${draft.status}'`);
  }

  await repo.revokeApprovalsForDraft(draft.id);

  const contentHash = createHash('sha256').update(draft.content).digest('hex');

  await repo.insertApproval({
    draftId: draft.id,
    userId: params.userId,
    action: ApprovalAction.APPROVE,
    status: ApprovalStatus.ACTIVE,
    contentHash,
  });

  await repo.insertAuditLog({
    userId: params.userId,
    actorType: 'user',
    actorId: params.userId,
    action: AuditAction.USER_APPROVED_DRAFT,
    targetType: 'draft',
    targetId: draft.id,
    metadata: { contentHash },
  });

  const updated = await repo.updateDraft(draft.id, {
    status: DraftStatus.APPROVED,
    approvedBy: params.userId,
    approvedAt: new Date(),
  });

  if (!updated) {
    throw new DraftNotFoundError(draft.id);
  }

  return updated;
}

export async function rejectDraft(repo: DraftRepository, params: RejectDraftParams): Promise<Draft> {
  const draft = await repo.getDraftById(params.draftId);
  if (!draft) {
    throw new DraftNotFoundError(params.draftId);
  }

  if (draft.status === DraftStatus.SENT) {
    throw new InvalidDraftStateError('Cannot reject draft: draft is already sent');
  }

  if (draft.status !== DraftStatus.PENDING_APPROVAL && draft.status !== DraftStatus.APPROVED) {
    throw new InvalidDraftStateError(`Cannot reject draft with status '${draft.status}'`);
  }

  await repo.revokeApprovalsForDraft(draft.id);

  await repo.insertApproval({
    draftId: draft.id,
    userId: params.userId,
    action: ApprovalAction.REJECT,
    status: ApprovalStatus.ACTIVE,
  });

  await repo.insertAuditLog({
    userId: params.userId,
    actorType: 'user',
    actorId: params.userId,
    action: AuditAction.USER_REJECTED_DRAFT,
    targetType: 'draft',
    targetId: draft.id,
    metadata: params.reason ? { reason: params.reason } : {},
  });

  const updated = await repo.updateDraft(draft.id, {
    status: DraftStatus.REJECTED,
    approvedBy: null,
    approvedAt: null,
  });

  if (!updated) {
    throw new DraftNotFoundError(draft.id);
  }

  return updated;
}

export async function updateDraftContent(
  repo: DraftRepository,
  params: UpdateDraftContentParams
): Promise<Draft> {
  const draft = await repo.getDraftById(params.draftId);
  if (!draft) {
    throw new DraftNotFoundError(params.draftId);
  }

  if (!params.newContent || !params.newContent.trim()) {
    throw new DraftContentEmptyError();
  }

  if (draft.status === DraftStatus.SENT) {
    throw new InvalidDraftStateError('Cannot edit draft: draft is already sent');
  }

  await repo.revokeApprovalsForDraft(draft.id);

  await repo.insertAuditLog({
    userId: params.userId,
    actorType: 'user',
    actorId: params.userId,
    action: AuditAction.USER_EDITED_DRAFT,
    targetType: 'draft',
    targetId: draft.id,
    metadata: { previousStatus: draft.status },
  });

  const updated = await repo.updateDraft(draft.id, {
    content: params.newContent,
    status: DraftStatus.PENDING_APPROVAL,
    approvedBy: null,
    approvedAt: null,
  });

  if (!updated) {
    throw new DraftNotFoundError(draft.id);
  }

  return updated;
}

export class DraftService {
  constructor(private readonly repo: DraftRepository) {}

  async createDraft(params: CreateDraftParams): Promise<Draft> {
    return createDraft(this.repo, params);
  }

  async approveDraft(params: ApproveDraftParams): Promise<Draft> {
    return approveDraft(this.repo, params);
  }

  async rejectDraft(params: RejectDraftParams): Promise<Draft> {
    return rejectDraft(this.repo, params);
  }

  async updateDraftContent(params: UpdateDraftContentParams): Promise<Draft> {
    return updateDraftContent(this.repo, params);
  }
}
