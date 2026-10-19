import { describe, expect, it } from 'bun:test';
import {
  DraftStatus,
  DraftService,
  type DraftRepository,
  type Draft,
  type Approval,
  InvalidDraftStateError,
  DraftNotFoundError,
  DraftContentEmptyError,
} from '../src';

describe('DraftService domain logic', () => {
  function createMockRepo(initialDraft?: Draft): { repo: DraftRepository; state: { drafts: Draft[]; approvals: Approval[]; audits: any[] } } {
    const state = {
      drafts: initialDraft ? [initialDraft] : [],
      approvals: [] as Approval[],
      audits: [] as any[],
    };
    const repo: DraftRepository = {
      async getDraftById(id) {
        return state.drafts.find((d) => d.id === id) ?? null;
      },
      async createDraft(data) {
        const d: Draft = {
          id: state.drafts.length + 1,
          conversationId: data.conversationId,
          agentRunId: data.agentRunId ?? null,
          content: data.content,
          status: data.status ?? DraftStatus.PENDING_APPROVAL,
          approvedBy: null,
          approvedAt: null,
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.drafts.push(d);
        return d;
      },
      async updateDraft(id, data) {
        const d = state.drafts.find((item) => item.id === id);
        if (!d) return null;
        Object.assign(d, data, { updatedAt: new Date() });
        return d;
      },
      async insertApproval(data) {
        const a: Approval = {
          id: state.approvals.length + 1,
          draftId: data.draftId,
          userId: data.userId,
          action: data.action,
          status: data.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.approvals.push(a);
        return a;
      },
      async revokeApprovalsForDraft(draftId) {
        for (const a of state.approvals) {
          if (a.draftId === draftId) a.status = 'revoked';
        }
      },
      async insertAuditLog(log) {
        state.audits.push(log);
      },
    };
    return { repo, state };
  }

  it('creates draft in PENDING_APPROVAL status', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    expect(draft.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(state.drafts[0]!.content).toBe('Hello client');
  });

  it('approves a pending draft and records approval + audit log', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    
    const approved = await service.approveDraft({ draftId: draft.id, userId: 1 });
    expect(approved.status).toBe(DraftStatus.APPROVED);
    expect(approved.approvedBy).toBe(1);
    expect(approved.approvedAt).toBeDefined();
    expect(state.approvals.length).toBe(1);
    expect(state.approvals[0]!.action).toBe('approve');
    expect(state.approvals[0]!.status).toBe('active');
    expect(state.audits.length).toBe(1);
    expect(state.audits[0]!.action).toBe('USER_APPROVED_DRAFT');
  });

  it('revokes active approval and reverts to PENDING_APPROVAL when content is edited', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    await service.approveDraft({ draftId: draft.id, userId: 1 });

    const updated = await service.updateDraftContent({ draftId: draft.id, newContent: 'Updated message', userId: 1 });
    expect(updated.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(updated.content).toBe('Updated message');
    expect(updated.approvedBy).toBeNull();
    expect(updated.approvedAt).toBeNull();
    expect(state.approvals[0]!.status).toBe('revoked');
    expect(state.audits.some((a) => a.action === 'USER_EDITED_DRAFT')).toBe(true);
  });

  it('rejects an approved or pending draft', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    await service.approveDraft({ draftId: draft.id, userId: 1 });

    const rejected = await service.rejectDraft({ draftId: draft.id, userId: 1, reason: 'Tone too casual' });
    expect(rejected.status).toBe(DraftStatus.REJECTED);
    expect(state.approvals.find((a) => a.action === 'approve')?.status).toBe('revoked');
    expect(state.approvals.find((a) => a.action === 'reject')?.status).toBe('active');
    expect(state.audits.some((a) => a.action === 'USER_REJECTED_DRAFT')).toBe(true);
  });

  it('throws InvalidDraftStateError when attempting to edit or approve a SENT draft', async () => {
    const initial: Draft = {
      id: 99,
      conversationId: 10,
      content: 'Already sent',
      status: DraftStatus.SENT,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { repo } = createMockRepo(initial);
    const service = new DraftService(repo);

    expect(service.approveDraft({ draftId: 99, userId: 1 })).rejects.toThrow(InvalidDraftStateError);
    expect(service.updateDraftContent({ draftId: 99, newContent: 'New', userId: 1 })).rejects.toThrow(InvalidDraftStateError);
  });

  it('throws DraftNotFoundError when draft does not exist', async () => {
    const { repo } = createMockRepo();
    const service = new DraftService(repo);

    expect(service.approveDraft({ draftId: 999, userId: 1 })).rejects.toThrow(DraftNotFoundError);
    expect(service.rejectDraft({ draftId: 999, userId: 1 })).rejects.toThrow(DraftNotFoundError);
    expect(service.updateDraftContent({ draftId: 999, newContent: 'abc', userId: 1 })).rejects.toThrow(DraftNotFoundError);
  });

  it('throws DraftContentEmptyError when draft content is blank', async () => {
    const { repo } = createMockRepo();
    const service = new DraftService(repo);

    expect(service.createDraft({ conversationId: 1, content: '   ' })).rejects.toThrow(DraftContentEmptyError);

    const draft = await service.createDraft({ conversationId: 1, content: 'Valid content' });
    expect(service.updateDraftContent({ draftId: draft.id, newContent: '', userId: 1 })).rejects.toThrow(DraftContentEmptyError);
  });
});
