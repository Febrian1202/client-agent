import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DraftStatus } from '@client-agent/domain';
import {
  db,
  getOwnerUserId,
  insertClient,
  insertConversation,
  insertDraft,
  getDraftById,
  listDrafts,
  updateDraft,
  insertApproval,
  revokeApprovalsForDraft,
  getApprovalsByDraftId,
  getDraftWithContext,
  createDbDraftRepository,
  draftService,
  approvals,
  drafts,
  conversations,
  clients,
} from '../src';

describe('drafts and approvals schema & queries', () => {
  let createdClientId: number | undefined;
  let createdConvId: number | undefined;
  let createdDraftId: number | undefined;

  afterAll(async () => {
    if (createdDraftId) {
      await db.delete(approvals).where(eq(approvals.draftId, createdDraftId));
      await db.delete(drafts).where(eq(drafts.id, createdDraftId));
    }
    if (createdConvId) {
      await db.delete(conversations).where(eq(conversations.id, createdConvId));
    }
    if (createdClientId) {
      await db.delete(clients).where(eq(clients.id, createdClientId));
    }
  });

  it('creates draft in pending_approval status, records approval, and revokes it on edit', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `test_client_${Date.now()}`,
    });
    createdClientId = client.id;

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_${Date.now()}`,
    });
    createdConvId = conv.id;

    // 1. Insert draft
    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Original draft content',
      status: 'pending_approval',
    });
    createdDraftId = draft.id;
    expect(draft.id).toBeDefined();
    expect(draft.status).toBe('pending_approval');
    expect(draft.content).toBe('Original draft content');

    // 2. Fetch by id and list
    const fetched = await getDraftById(draft.id);
    expect(fetched?.id).toBe(draft.id);
    const draftsList = await listDrafts({ conversationId: conv.id });
    expect(draftsList.length).toBeGreaterThanOrEqual(1);

    // 3. Insert approval
    const approval = await insertApproval({
      draftId: draft.id,
      userId: ownerId,
      action: 'approve',
      status: 'active',
    });
    expect(approval.status).toBe('active');
    expect(approval.action).toBe('approve');

    // 4. Test getDraftWithContext
    const context = await getDraftWithContext(draft.id);
    expect(context).not.toBeNull();
    expect(context?.draft.id).toBe(draft.id);
    expect(context?.conversation.id).toBe(conv.id);
    expect(context?.approvals.length).toBe(1);
    expect(context?.approvals[0]?.id).toBe(approval.id);

    // 5. Update draft to approved
    const approvedDraft = await updateDraft(draft.id, {
      status: 'approved',
      approvedBy: ownerId,
      approvedAt: new Date(),
    });
    expect(approvedDraft?.status).toBe('approved');
    expect(approvedDraft?.approvedBy).toBe(ownerId);

    // 6. Revoke approval and reset draft
    await revokeApprovalsForDraft(draft.id);
    const approvals = await getApprovalsByDraftId(draft.id);
    expect(approvals[0]?.status).toBe('revoked');

    const resetDraft = await updateDraft(draft.id, {
      content: 'Updated draft content',
      status: 'pending_approval',
      approvedBy: null,
      approvedAt: null,
    });
    expect(resetDraft?.status).toBe('pending_approval');
    expect(resetDraft?.content).toBe('Updated draft content');
    expect(resetDraft?.approvedBy).toBeNull();
  });

  it('integrates with DraftService via createDbDraftRepository', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `service_client_${Date.now()}`,
    });

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `service_conv_${Date.now()}`,
    });

    const repo = createDbDraftRepository();
    expect(repo).toBeDefined();

    const createdDraft = await draftService.createDraft({
      conversationId: conv.id,
      content: 'Initial generated draft message',
      userId: ownerId,
    });
    expect(createdDraft.id).toBeDefined();
    expect(createdDraft.status).toBe(DraftStatus.PENDING_APPROVAL);

    const approvedDraft = await draftService.approveDraft({
      draftId: createdDraft.id,
      userId: ownerId,
    });
    expect(approvedDraft.status).toBe(DraftStatus.APPROVED);
    expect(approvedDraft.approvedBy).toBe(ownerId);

    const editedDraft = await draftService.updateDraftContent({
      draftId: createdDraft.id,
      newContent: 'Edited message text',
      userId: ownerId,
    });
    expect(editedDraft.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(editedDraft.content).toBe('Edited message text');
    expect(editedDraft.approvedBy).toBeNull();

    const rejectedDraft = await draftService.rejectDraft({
      draftId: createdDraft.id,
      userId: ownerId,
      reason: 'Not good enough',
    });
    expect(rejectedDraft.status).toBe(DraftStatus.REJECTED);

    // Clean up
    await db.delete(approvals).where(eq(approvals.draftId, createdDraft.id));
    await db.delete(drafts).where(eq(drafts.id, createdDraft.id));
    await db.delete(conversations).where(eq(conversations.id, conv.id));
    await db.delete(clients).where(eq(clients.id, client.id));
  });
});
