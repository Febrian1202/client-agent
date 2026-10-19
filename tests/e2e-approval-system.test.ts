import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { inArray } from 'drizzle-orm';
import {
  db,
  drafts as draftsTable,
  approvals,
  auditLogs,
  agentRuns,
  agentTasks,
  clients,
  conversations,
  getDraftById,
  getApprovalsByDraftId,
  getOwnerUserId,
  insertClient,
  insertConversation,
  createTask,
  getTaskById,
  updateDraft,
  eq,
  and,
} from '@client-agent/db';
import {
  AuditAction,
  DraftStatus,
  TaskType,
  TaskStatus,
  ApprovalAction,
  ApprovalStatus,
} from '@client-agent/domain';
import {
  handleDraftButtonInteraction,
  handleDraftModalSubmitInteraction,
} from '@client-agent/discord';
import { handleGenerateReplyDraft } from '../apps/worker/src/handlers/generateReplyDraft';
import { createDefaultDraftInteractionDeps } from '../apps/worker/src/bot';
import { app } from '../apps/api/src/app';

describe('Phase 5 Approval System End-to-End Integration', () => {
  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdTaskIds: number[] = [];
  const createdDraftIds: number[] = [];
  let ownerId: number;

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
  });

  afterAll(async () => {
    // Teardown in safe dependency order
    if (createdDraftIds.length > 0) {
      await db
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.targetType, 'draft'),
            inArray(auditLogs.targetId, createdDraftIds),
          ),
        );
      await db
        .delete(approvals)
        .where(inArray(approvals.draftId, createdDraftIds));
      await db
        .delete(draftsTable)
        .where(inArray(draftsTable.id, createdDraftIds));
    }

    if (createdTaskIds.length > 0) {
      await db
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.targetType, 'task'),
            inArray(auditLogs.targetId, createdTaskIds),
          ),
        );
      await db
        .delete(agentRuns)
        .where(inArray(agentRuns.taskId, createdTaskIds));
      await db
        .delete(agentTasks)
        .where(inArray(agentTasks.id, createdTaskIds));
    }

    if (createdConversationIds.length > 0) {
      await db
        .delete(conversations)
        .where(inArray(conversations.id, createdConversationIds));
    }

    if (createdClientIds.length > 0) {
      await db.delete(clients).where(inArray(clients.id, createdClientIds));
    }
  });

  it('executes full end-to-end lifecycle: draft generation -> Discord approve -> API edit -> API reject with audit logs', async () => {
    const timestamp = Date.now();
    const username = `e2e_approval_user_${timestamp}`;
    const externalConvId = `e2e_vgen_conv_${timestamp}`;

    // 1. Setup Client and Conversation
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: externalConvId,
    });
    createdConversationIds.push(conv.id);

    // 2. Create Task for reply draft generation
    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: username,
        instruction: 'Quote $150 commercial price and 2 week delivery',
        discord: {
          applicationId: 'app_e2e_test',
          interactionToken: 'token_e2e_test',
        },
      },
      idempotencyKey: `reply_e2e_${timestamp}`,
    });
    createdTaskIds.push(task.id);

    // 3. Worker generates draft via handleGenerateReplyDraft
    const generatedReply = 'Hi! Thanks for reaching out. Commercial price is $150 and delivery is 2 weeks.';
    let sentFollowupContent = '';
    let sentFollowupComponents: any = null;

    const mockAiClient: any = {
      createChatCompletion: async () => ({
        content: generatedReply,
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        durationMs: 85,
        usage: { promptTokens: 60, completionTokens: 25, totalTokens: 85 },
      }),
    };

    const mockMessenger: any = {
      editInteractionFollowup: async ({ content, components }: any) => {
        sentFollowupContent = content;
        sentFollowupComponents = components;
        return { messageId: 'msg-e2e-1' };
      },
    };

    await handleGenerateReplyDraft(
      {
        id: 'stream-e2e-1',
        data: { taskId: String(task.id) },
      },
      {
        aiClient: mockAiClient,
        messenger: mockMessenger,
      },
    );

    // Verify task completion and output
    const completedTask = await getTaskById(task.id);
    expect(completedTask).not.toBeNull();
    expect(completedTask!.status).toBe(TaskStatus.COMPLETED);
    const taskOutput = completedTask!.output as any;
    expect(taskOutput?.draftId).toBeDefined();

    const draftId = Number(taskOutput.draftId);
    createdDraftIds.push(draftId);

    // Verify Draft in PostgreSQL
    const createdDraft = await getDraftById(draftId);
    expect(createdDraft).not.toBeNull();
    expect(createdDraft!.conversationId).toBe(conv.id);
    expect(createdDraft!.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(createdDraft!.content).toBe(generatedReply);
    expect(createdDraft!.approvedBy).toBeNull();
    expect(createdDraft!.approvedAt).toBeNull();

    // Verify AGENT_GENERATED_DRAFT audit log in PostgreSQL
    const agentDraftAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draftId),
          eq(auditLogs.action, AuditAction.AGENT_GENERATED_DRAFT),
        ),
      );
    expect(agentDraftAudits).toHaveLength(1);
    expect(agentDraftAudits[0]!.actorType).toBe('agent');

    // Verify Discord followup message contained action row buttons
    expect(sentFollowupContent).toContain(username);
    expect(sentFollowupComponents).toBeDefined();
    expect(Array.isArray(sentFollowupComponents)).toBe(true);
    expect(sentFollowupComponents.length).toBeGreaterThan(0);

    // 4. Creator clicks [Approve ✅] via Discord button interaction
    const draftDeps = createDefaultDraftInteractionDeps();
    let discordUpdateData: any = null;

    const approveButtonInteraction: any = {
      isButton: () => true,
      isChatInputCommand: () => false,
      isModalSubmit: () => false,
      customId: `approve_draft:${draftId}`,
      user: { id: 'discord-creator-id', username: 'TestCreator' },
      message: { content: sentFollowupContent },
      update: async (data: any) => {
        discordUpdateData = data;
      },
    };

    await handleDraftButtonInteraction(approveButtonInteraction, draftDeps);

    // Verify Discord response
    expect(discordUpdateData).not.toBeNull();
    expect(discordUpdateData.content).toContain('✅ Approved by TestCreator');

    // Verify Draft is APPROVED in DB
    const approvedDraft = await getDraftById(draftId);
    expect(approvedDraft!.status).toBe(DraftStatus.APPROVED);
    expect(approvedDraft!.approvedBy).toBe(ownerId);
    expect(approvedDraft!.approvedAt).not.toBeNull();

    // Verify Approval row inserted in active status
    const approvalsAfterApprove = await getApprovalsByDraftId(draftId);
    expect(approvalsAfterApprove).toHaveLength(1);
    expect(approvalsAfterApprove[0]!.action).toBe(ApprovalAction.APPROVE);
    expect(approvalsAfterApprove[0]!.status).toBe(ApprovalStatus.ACTIVE);
    expect(approvalsAfterApprove[0]!.userId).toBe(ownerId);

    // Verify USER_APPROVED_DRAFT audit log
    const approveAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draftId),
          eq(auditLogs.action, AuditAction.USER_APPROVED_DRAFT),
        ),
      );
    expect(approveAudits).toHaveLength(1);
    expect(approveAudits[0]!.actorType).toBe('user');
    expect(approveAudits[0]!.userId).toBe(ownerId);

    // 5. Creator edits draft via REST API: PATCH /api/v1/drafts/:id
    // Must revert status to pending_approval and revoke active approvals
    const updatedContent = 'Hi! Commercial price is $175 and delivery is 10 business days.';
    const editResponse = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      }),
    );
    expect(editResponse.status).toBe(200);
    const editResponseBody = await editResponse.json();
    expect(editResponseBody.draft.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(editResponseBody.draft.content).toBe(updatedContent);
    expect(editResponseBody.draft.approvedBy).toBeNull();
    expect(editResponseBody.draft.approvedAt).toBeNull();

    // Verify Draft in PostgreSQL after edit
    const draftAfterEdit = await getDraftById(draftId);
    expect(draftAfterEdit!.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(draftAfterEdit!.content).toBe(updatedContent);
    expect(draftAfterEdit!.approvedBy).toBeNull();
    expect(draftAfterEdit!.approvedAt).toBeNull();

    // Verify prior approval is now REVOKED
    const approvalsAfterEdit = await getApprovalsByDraftId(draftId);
    expect(approvalsAfterEdit).toHaveLength(1);
    expect(approvalsAfterEdit[0]!.action).toBe(ApprovalAction.APPROVE);
    expect(approvalsAfterEdit[0]!.status).toBe(ApprovalStatus.REVOKED);

    // Verify USER_EDITED_DRAFT audit log
    const editAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draftId),
          eq(auditLogs.action, AuditAction.USER_EDITED_DRAFT),
        ),
      );
    expect(editAudits).toHaveLength(1);
    expect(editAudits[0]!.actorType).toBe('user');
    expect(editAudits[0]!.userId).toBe(ownerId);
    expect(editAudits[0]!.metadata).toEqual({ previousStatus: 'approved' });

    // 6. Creator rejects draft via REST API: POST /api/v1/drafts/:id/reject
    const rejectReason = 'Client requested rush order that cannot be fulfilled';
    const rejectResponse = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      }),
    );
    expect(rejectResponse.status).toBe(200);
    const rejectResponseBody = await rejectResponse.json();
    expect(rejectResponseBody.draft.status).toBe(DraftStatus.REJECTED);

    // Verify Draft in PostgreSQL is REJECTED
    const draftAfterReject = await getDraftById(draftId);
    expect(draftAfterReject!.status).toBe(DraftStatus.REJECTED);

    // Verify new rejection row in approvals table
    const approvalsAfterReject = await getApprovalsByDraftId(draftId);
    expect(approvalsAfterReject).toHaveLength(2);
    const rejectApproval = approvalsAfterReject.find((a) => a.action === ApprovalAction.REJECT);
    expect(rejectApproval).toBeDefined();
    expect(rejectApproval!.status).toBe(ApprovalStatus.ACTIVE);

    // Verify USER_REJECTED_DRAFT audit log with reason in metadata
    const rejectAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draftId),
          eq(auditLogs.action, AuditAction.USER_REJECTED_DRAFT),
        ),
      );
    expect(rejectAudits).toHaveLength(1);
    expect(rejectAudits[0]!.actorType).toBe('user');
    expect(rejectAudits[0]!.metadata).toEqual({ reason: rejectReason });
  });

  it('supports Discord modal editing and Discord button rejection workflows', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `e2e_modal_user_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `e2e_modal_conv_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    // Create a draft via REST API
    const resCreate = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conv.id,
          content: 'Initial modal test draft content',
        }),
      }),
    );
    expect(resCreate.status).toBe(201);
    const bodyCreate = await resCreate.json();
    const draftId = bodyCreate.draft.id;
    createdDraftIds.push(draftId);

    // Approve the draft via REST API
    const resApprove = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/approve`, {
        method: 'POST',
      }),
    );
    expect(resApprove.status).toBe(200);

    const draftDeps = createDefaultDraftInteractionDeps();

    // 1. Submit edit via Discord Modal interaction
    let modalUpdateData: any = null;
    const modalInteraction: any = {
      isButton: () => false,
      isChatInputCommand: () => false,
      isModalSubmit: () => true,
      customId: `modal_edit_draft:${draftId}`,
      user: { id: 'discord-creator-id', username: 'ModalCreator' },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'draft_content') return 'Edited text submitted from Discord modal';
          return '';
        },
      },
      message: {
        content: `✍️ **Draft Reply for @${client.username}**\nInitial modal test draft content\n*(Draft only — human approval required before sending)*`,
      },
      update: async (data: any) => {
        modalUpdateData = data;
      },
    };

    await handleDraftModalSubmitInteraction(modalInteraction, draftDeps);

    // Verify modal update revived action row buttons and updated text
    expect(modalUpdateData).not.toBeNull();
    expect(modalUpdateData.content).toContain('Edited text submitted from Discord modal');
    expect(modalUpdateData.components).toBeDefined();

    // Verify DB state reverted to pending_approval and revoked prior approval
    const draftAfterModal = await getDraftById(draftId);
    expect(draftAfterModal!.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(draftAfterModal!.content).toBe('Edited text submitted from Discord modal');
    expect(draftAfterModal!.approvedBy).toBeNull();

    const approvalsAfterModal = await getApprovalsByDraftId(draftId);
    expect(approvalsAfterModal[0]!.status).toBe(ApprovalStatus.REVOKED);

    // 2. Reject via Discord Button interaction
    let rejectUpdateData: any = null;
    const rejectButtonInteraction: any = {
      isButton: () => true,
      isChatInputCommand: () => false,
      isModalSubmit: () => false,
      customId: `reject_draft:${draftId}`,
      user: { id: 'discord-creator-id', username: 'ModalCreator' },
      message: { content: modalUpdateData.content },
      update: async (data: any) => {
        rejectUpdateData = data;
      },
    };

    await handleDraftButtonInteraction(rejectButtonInteraction, draftDeps);

    expect(rejectUpdateData).not.toBeNull();
    expect(rejectUpdateData.content).toContain('❌ Rejected by ModalCreator');

    const draftAfterReject = await getDraftById(draftId);
    expect(draftAfterReject!.status).toBe(DraftStatus.REJECTED);
  });

  it('enforces 2000 character maximum validation cap on REST API', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `e2e_limit_user_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `e2e_limit_conv_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    // Exceeding 2000 characters on POST /api/v1/drafts -> 422 VALIDATION_ERROR
    const overLimitContent = 'A'.repeat(2001);
    const resOverPost = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conv.id,
          content: overLimitContent,
        }),
      }),
    );
    expect(resOverPost.status).toBe(422);
    const bodyOverPost = await resOverPost.json();
    expect(bodyOverPost.error.code).toBe('VALIDATION_ERROR');

    // Exactly 2000 characters on POST /api/v1/drafts -> 201 Created
    const exact2000Content = 'B'.repeat(2000);
    const resExactPost = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conv.id,
          content: exact2000Content,
        }),
      }),
    );
    expect(resExactPost.status).toBe(201);
    const bodyExactPost = await resExactPost.json();
    const validDraftId = bodyExactPost.draft.id;
    createdDraftIds.push(validDraftId);
    expect(bodyExactPost.draft.content.length).toBe(2000);

    // Exceeding 2000 characters on PATCH /api/v1/drafts/:id -> 422 VALIDATION_ERROR
    const resOverPatch = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${validDraftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'C'.repeat(2001),
        }),
      }),
    );
    expect(resOverPatch.status).toBe(422);
    const bodyOverPatch = await resOverPatch.json();
    expect(bodyOverPatch.error.code).toBe('VALIDATION_ERROR');

    // Exactly 2000 characters on PATCH /api/v1/drafts/:id -> 200 OK
    const resExactPatch = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${validDraftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'D'.repeat(2000),
        }),
      }),
    );
    expect(resExactPatch.status).toBe(200);
    const bodyExactPatch = await resExactPatch.json();
    expect(bodyExactPatch.draft.content.length).toBe(2000);
    expect(bodyExactPatch.draft.content).toBe('D'.repeat(2000));
  });

  it('rejects invalid state transitions and enforces error envelopes', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `e2e_state_user_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `e2e_state_conv_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    // Create and simulate sent draft
    const resCreate = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conv.id,
          content: 'Sent draft message',
        }),
      }),
    );
    const bodyCreate = await resCreate.json();
    const draftId = bodyCreate.draft.id;
    createdDraftIds.push(draftId);

    // Update status to 'sent'
    await updateDraft(draftId, { status: 'sent', sentAt: new Date() });

    // Approving a SENT draft must return 409 INVALID_DRAFT_STATE
    const resApprove = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/approve`, {
        method: 'POST',
      }),
    );
    expect(resApprove.status).toBe(409);
    const bodyApprove = await resApprove.json();
    expect(bodyApprove.error.code).toBe('INVALID_DRAFT_STATE');

    // Editing a SENT draft must return 409 INVALID_DRAFT_STATE
    const resEdit = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Attempted edit on sent draft' }),
      }),
    );
    expect(resEdit.status).toBe(409);
    const bodyEdit = await resEdit.json();
    expect(bodyEdit.error.code).toBe('INVALID_DRAFT_STATE');

    // Rejecting a SENT draft must return 409 INVALID_DRAFT_STATE
    const resReject = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/reject`, {
        method: 'POST',
      }),
    );
    expect(resReject.status).toBe(409);
    const bodyReject = await resReject.json();
    expect(bodyReject.error.code).toBe('INVALID_DRAFT_STATE');

    // Non-existent draft ID returns 404
    const resNotFound = await app.handle(
      new Request('http://localhost/api/v1/drafts/999999999'),
    );
    expect(resNotFound.status).toBe(404);
    const bodyNotFound = await resNotFound.json();
    expect(bodyNotFound.error.code).toBe('DRAFT_NOT_FOUND');
  });
});
