import { describe, expect, it, afterAll } from 'bun:test';
import { app } from '../src/app';
import {
  db,
  agentTasks,
  drafts,
  conversations,
  clients,
  eq,
  insertDraft,
  insertClient,
  insertConversation,
  getOwnerUserId,
} from '@client-agent/db';
import { DraftStatus } from '@client-agent/domain';

describe('POST /api/v1/drafts/:id/send', () => {
  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdDraftIds: number[] = [];
  const createdTaskIds: number[] = [];

  afterAll(async () => {
    for (const taskId of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
    }
    for (const draftId of createdDraftIds) {
      await db.delete(drafts).where(eq(drafts.id, draftId));
    }
    for (const convId of createdConversationIds) {
      await db.delete(conversations).where(eq(conversations.id, convId));
    }
    for (const clientId of createdClientIds) {
      await db.delete(clients).where(eq(clients.id, clientId));
    }
  });

  it('returns 404 Not Found when draft does not exist', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/drafts/99999999/send', { method: 'POST' })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('returns 409 Conflict when draft is not approved', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `test_send_1_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `vgen_send_1_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Draft text',
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, { method: 'POST' })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_APPROVED');
  });

  it('returns 202 Accepted and enqueues task when draft is approved', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `test_send_2_${Date.now()}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `vgen_send_2_${Date.now()}`,
    });
    createdConversationIds.push(conv.id);

    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Approved draft text',
      status: DraftStatus.APPROVED,
      approvedBy: ownerId,
      approvedAt: new Date(),
    });
    createdDraftIds.push(draft.id);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, { method: 'POST' })
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.taskId).toBeDefined();
    expect(body.status).toBe('queued');

    if (body.taskId) {
      createdTaskIds.push(Number(body.taskId));
    }
  });
});
