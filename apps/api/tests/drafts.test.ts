import { describe, expect, it, afterAll } from 'bun:test';
import { createApp } from '../src/app';
import { createSession } from '../src/auth/session';
import {
  db,
  drafts,
  approvals,
  clients,
  conversations,
  eq,
  getOwnerUserId,
  insertClient,
  insertConversation,
  updateDraft,
} from '@client-agent/db';

describe('Drafts API (/api/v1/drafts)', () => {
  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdDraftIds: number[] = [];

  afterAll(async () => {
    for (const draftId of createdDraftIds) {
      await db.delete(approvals).where(eq(approvals.draftId, draftId));
      await db.delete(drafts).where(eq(drafts.id, draftId));
    }
    for (const convId of createdConversationIds) {
      await db.delete(conversations).where(eq(conversations.id, convId));
    }
    for (const clientId of createdClientIds) {
      await db.delete(clients).where(eq(clients.id, clientId));
    }
  });

  it('implements full draft CRUD and state machine transitions', async () => {
    const app = createApp();
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `api_client_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `api_conv_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    // 1. Create draft
    const resCreate = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, content: 'Initial message' }),
      }),
    );
    expect(resCreate.status).toBe(201);
    const bodyCreate = await resCreate.json();
    const draftId = bodyCreate.draft.id;
    createdDraftIds.push(draftId);
    expect(bodyCreate.draft.status).toBe('pending_approval');

    // 2. Get draft
    const resGet = await app.handle(new Request(`http://localhost/api/v1/drafts/${draftId}`));
    expect(resGet.status).toBe(200);
    const bodyGet = await resGet.json();
    expect(bodyGet.draft.id).toBe(draftId);
    expect(bodyGet.conversation.id).toBe(conv.id);
    expect(Array.isArray(bodyGet.approvals)).toBe(true);

    // 3. Approve draft
    const resApprove = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/approve`, { method: 'POST' }),
    );
    expect(resApprove.status).toBe(200);
    const bodyApprove = await resApprove.json();
    expect(bodyApprove.draft.status).toBe('approved');
    expect(bodyApprove.draft.approvedBy).toBe(ownerId);

    // 4. Edit draft (must revert to pending_approval and revoke approval)
    const resEdit = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Edited message' }),
      }),
    );
    expect(resEdit.status).toBe(200);
    const bodyEdit = await resEdit.json();
    expect(bodyEdit.draft.status).toBe('pending_approval');
    expect(bodyEdit.draft.content).toBe('Edited message');
    expect(bodyEdit.draft.approvedBy).toBeNull();

    // 5. Reject draft
    const resReject = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Not interested' }),
      }),
    );
    expect(resReject.status).toBe(200);
    const bodyReject = await resReject.json();
    expect(bodyReject.draft.status).toBe('rejected');
  });

  it('lists drafts with filtering and pagination', async () => {
    const app = createApp();
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `filter_client_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `filter_conv_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    const res1 = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, content: 'First message' }),
      }),
    );
    const body1 = await res1.json();
    createdDraftIds.push(body1.draft.id);

    const res2 = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, content: 'Second message' }),
      }),
    );
    const body2 = await res2.json();
    createdDraftIds.push(body2.draft.id);

    // Filter by conversationId
    const resList = await app.handle(
      new Request(`http://localhost/api/v1/drafts?conversation_id=${conv.id}&limit=1`),
    );
    expect(resList.status).toBe(200);
    const bodyList = await resList.json();
    expect(bodyList.drafts.length).toBe(1);

    // Filter by status
    const resStatus = await app.handle(
      new Request(`http://localhost/api/v1/drafts?status=pending_approval&conversation_id=${conv.id}`),
    );
    expect(resStatus.status).toBe(200);
    const bodyStatus = await resStatus.json();
    expect(bodyStatus.drafts.length).toBe(2);
  });

  it('returns 404 for non-existent draft ID', async () => {
    const app = createApp();

    const resGet = await app.handle(new Request('http://localhost/api/v1/drafts/99999999'));
    expect(resGet.status).toBe(404);
    const bodyGet = await resGet.json();
    expect(bodyGet.error.code).toBe('DRAFT_NOT_FOUND');

    const resApprove = await app.handle(
      new Request('http://localhost/api/v1/drafts/99999999/approve', { method: 'POST' }),
    );
    expect(resApprove.status).toBe(404);
    const bodyApprove = await resApprove.json();
    expect(bodyApprove.error.code).toBe('DRAFT_NOT_FOUND');

    const resReject = await app.handle(
      new Request('http://localhost/api/v1/drafts/99999999/reject', { method: 'POST' }),
    );
    expect(resReject.status).toBe(404);
    const bodyReject = await resReject.json();
    expect(bodyReject.error.code).toBe('DRAFT_NOT_FOUND');

    const resEdit = await app.handle(
      new Request('http://localhost/api/v1/drafts/99999999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated' }),
      }),
    );
    expect(resEdit.status).toBe(404);
    const bodyEdit = await resEdit.json();
    expect(bodyEdit.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('returns 409 when attempting invalid draft state transitions', async () => {
    const app = createApp();
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `conflict_client_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conflict_conv_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    const resCreate = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, content: 'To be sent' }),
      }),
    );
    const bodyCreate = await resCreate.json();
    const draftId = bodyCreate.draft.id;
    createdDraftIds.push(draftId);

    // Mark as sent directly in DB to simulate a sent draft
    await updateDraft(draftId, { status: 'sent', sentAt: new Date() });

    // Approving sent draft must return 409
    const resApprove = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/approve`, { method: 'POST' }),
    );
    expect(resApprove.status).toBe(409);
    const bodyApprove = await resApprove.json();
    expect(bodyApprove.error.code).toBe('INVALID_DRAFT_STATE');

    // Editing sent draft must return 409
    const resEdit = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Cannot change sent draft' }),
      }),
    );
    expect(resEdit.status).toBe(409);
    const bodyEdit = await resEdit.json();
    expect(bodyEdit.error.code).toBe('INVALID_DRAFT_STATE');

    // Rejecting sent draft must return 409
    const resReject = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/reject`, { method: 'POST' }),
    );
    expect(resReject.status).toBe(409);
    const bodyReject = await resReject.json();
    expect(bodyReject.error.code).toBe('INVALID_DRAFT_STATE');
  });

  it('rejects draft without providing a reason and handles session cookie auth', async () => {
    const app = createApp();
    const ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);

    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `cookie_client_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `cookie_conv_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    // Create draft with session cookie
    const resCreate = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `session=${sessionId}`,
        },
        body: JSON.stringify({ conversationId: conv.id, content: 'Session message' }),
      }),
    );
    expect(resCreate.status).toBe(201);
    const bodyCreate = await resCreate.json();
    const draftId = bodyCreate.draft.id;
    createdDraftIds.push(draftId);

    // Approve with session cookie
    const resApprove = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: { Cookie: `session=${sessionId}` },
      }),
    );
    expect(resApprove.status).toBe(200);
    const bodyApprove = await resApprove.json();
    expect(bodyApprove.draft.approvedBy).toBe(ownerId);

    // Reject without body
    const resReject = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/reject`, {
        method: 'POST',
        headers: { Cookie: `session=${sessionId}` },
      }),
    );
    expect(resReject.status).toBe(200);
    const bodyReject = await resReject.json();
    expect(bodyReject.draft.status).toBe('rejected');
  });

  it('validates request schemas and returns validation error envelope', async () => {
    const app = createApp();

    // Missing conversationId
    const res1 = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Message without conversation' }),
      }),
    );
    expect(res1.status).toBe(422);
    const body1 = await res1.json();
    expect(body1.error.code).toBe('VALIDATION_ERROR');

    // Empty content on PATCH
    const res2 = await app.handle(
      new Request('http://localhost/api/v1/drafts/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      }),
    );
    expect(res2.status).toBe(422);
    const body2 = await res2.json();
    expect(body2.error.code).toBe('VALIDATION_ERROR');
  });
});
