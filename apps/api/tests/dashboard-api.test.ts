import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import {
  db,
  clients,
  commissions,
  conversations,
  messages,
  drafts,
  auditLogs,
  getOwnerUserId,
  upsertClient,
  upsertCommission,
  upsertConversation,
  insertMessagesIfNew,
  insertDraft,
  insertAuditLog,
} from '@client-agent/db';
import { CommissionStatus, DraftStatus } from '@client-agent/domain';
import { app } from '../src/app';
import { createSession } from '../src/auth/session';

describe('Dashboard REST API Endpoints', () => {
  let cookieHeader: string;
  let ownerId: number;

  const createdCommissionIds: number[] = [];
  const createdDraftIds: number[] = [];
  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdAuditLogIds: number[] = [];

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;
  });

  afterAll(async () => {
    if (createdDraftIds.length > 0) {
      await db.delete(drafts).where(inArray(drafts.id, createdDraftIds));
    }
    if (createdCommissionIds.length > 0) {
      await db.delete(commissions).where(inArray(commissions.id, createdCommissionIds));
    }
    for (const convId of createdConversationIds) {
      await db.delete(messages).where(eq(messages.conversationId, convId));
    }
    if (createdConversationIds.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
    }
    if (createdClientIds.length > 0) {
      await db.delete(clients).where(inArray(clients.id, createdClientIds));
    }
    if (createdAuditLogIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.id, createdAuditLogIds));
    }
  });

  it('GET /api/v1/dashboard/summary requires authentication', async () => {
    const res = await app.handle(new Request('http://localhost/api/v1/dashboard/summary'));
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/dashboard/summary returns aggregated metrics and active commissions', async () => {
    const uniqueSuffix = Date.now().toString();
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_dash_${uniqueSuffix}`,
      displayName: 'Dashboard Test Client',
    });
    createdClientIds.push(client.id);

    const comm = await upsertCommission({
      clientId: client.id,
      externalId: `comm_${uniqueSuffix}`,
      serviceName: 'Live2D Character Model',
      amount: '500.00',
      currency: 'USD',
      status: CommissionStatus.IN_PROGRESS,
    });
    createdCommissionIds.push(comm.id);

    const inQueueComm = await upsertCommission({
      clientId: client.id,
      externalId: `comm_q_${uniqueSuffix}`,
      serviceName: 'Chibi Emote Pack',
      amount: '120.00',
      currency: 'USD',
      status: CommissionStatus.REQUESTED,
    });
    createdCommissionIds.push(inQueueComm.id);

    const conv = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_${uniqueSuffix}`,
    });
    createdConversationIds.push(conv.id);

    await insertMessagesIfNew(conv.id, [
      {
        externalId: `msg_${uniqueSuffix}_1`,
        direction: 'inbound',
        senderType: 'client',
        senderName: 'Dashboard Test Client',
        content: 'Hello creator! How is the model progressing?',
        sentAt: new Date(),
      },
    ]);

    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Hello! It is going great, sketches are ready.',
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    const res = await app.handle(
      new Request('http://localhost/api/v1/dashboard/summary', {
        headers: { Cookie: cookieHeader },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.metrics).toBeDefined();
    expect(body.metrics.activeCount).toBeGreaterThanOrEqual(1);
    expect(body.metrics.inQueueCount).toBeGreaterThanOrEqual(1);
    expect(typeof body.metrics.completedMonthCount).toBe('number');
    expect(body.metrics.pendingDraftCount).toBeGreaterThanOrEqual(1);

    expect(body.commissions).toBeArray();
    expect(body.commissions.length).toBeGreaterThanOrEqual(1);
    expect(body.recentMessages).toBeArray();
    expect(body.recentMessages.length).toBeGreaterThanOrEqual(1);
    expect(body.pendingDrafts).toBeArray();
    expect(body.pendingDrafts.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/commissions lists commissions with status filtering', async () => {
    const uniqueSuffix = `${Date.now()}_comm`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_comm_${uniqueSuffix}`,
      displayName: 'Commission Test Client',
    });
    createdClientIds.push(client.id);

    const comm = await upsertCommission({
      clientId: client.id,
      externalId: `comm_filter_${uniqueSuffix}`,
      serviceName: 'Illustration Full Body',
      amount: '350.00',
      currency: 'USD',
      status: CommissionStatus.IN_PROGRESS,
    });
    createdCommissionIds.push(comm.id);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/commissions?status=${CommissionStatus.IN_PROGRESS}`, {
        headers: { Cookie: cookieHeader },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commissions).toBeArray();
    const found = body.commissions.find((c: { id: number }) => c.id === comm.id);
    expect(found).toBeDefined();
    expect(found.serviceName).toBe('Illustration Full Body');
    expect(found.clientUsername).toBe(`client_comm_${uniqueSuffix}`);
  });

  it('GET /api/v1/commissions/:id returns detail and PATCH /:id updates commission', async () => {
    const uniqueSuffix = `${Date.now()}_patch`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_patch_${uniqueSuffix}`,
      displayName: 'Patch Client',
    });
    createdClientIds.push(client.id);

    const comm = await upsertCommission({
      clientId: client.id,
      externalId: `comm_patch_${uniqueSuffix}`,
      serviceName: 'Rigging Only',
      amount: '200.00',
      currency: 'USD',
      status: CommissionStatus.REQUESTED,
    });
    createdCommissionIds.push(comm.id);

    const getRes = await app.handle(
      new Request(`http://localhost/api/v1/commissions/${comm.id}`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.commission.id).toBe(comm.id);
    expect(getBody.commission.status).toBe(CommissionStatus.REQUESTED);

    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/commissions/${comm.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          status: CommissionStatus.ACCEPTED,
          amount: '250.00',
        }),
      })
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.commission.status).toBe(CommissionStatus.ACCEPTED);
    expect(Number(patchBody.commission.amount)).toBe(250);

    const notFoundRes = await app.handle(
      new Request('http://localhost/api/v1/commissions/999999999', {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(notFoundRes.status).toBe(404);
  });

  it('GET /api/v1/clients lists clients and GET /:id returns single client', async () => {
    const uniqueSuffix = `${Date.now()}_cl`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `searchable_${uniqueSuffix}`,
      displayName: 'Searchable Person',
    });
    createdClientIds.push(client.id);

    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients?search=searchable_${uniqueSuffix}`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.clients).toBeArray();
    expect(listBody.clients.some((c: { id: number }) => c.id === client.id)).toBe(true);

    const detailRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${client.id}`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(detailRes.status).toBe(200);
    const detailBody = await detailRes.json();
    expect(detailBody.client.id).toBe(client.id);
    expect(detailBody.client.username).toBe(`searchable_${uniqueSuffix}`);

    const notFoundRes = await app.handle(
      new Request('http://localhost/api/v1/clients/999999999', {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(notFoundRes.status).toBe(404);
  });

  it('GET /api/v1/conversations lists conversations with client metadata', async () => {
    const uniqueSuffix = `${Date.now()}_conv`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `conv_client_${uniqueSuffix}`,
      displayName: 'Conv Client',
    });
    createdClientIds.push(client.id);

    const conv = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_list_${uniqueSuffix}`,
    });
    createdConversationIds.push(conv.id);

    const listRes = await app.handle(
      new Request('http://localhost/api/v1/conversations', {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.conversations).toBeArray();
    const found = listBody.conversations.find((c: { id: number }) => c.id === conv.id);
    expect(found).toBeDefined();
    expect(found.clientUsername).toBe(`conv_client_${uniqueSuffix}`);

    const detailRes = await app.handle(
      new Request(`http://localhost/api/v1/conversations/${conv.id}`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(detailRes.status).toBe(200);
    const detailBody = await detailRes.json();
    expect(detailBody.conversation.id).toBe(conv.id);
    expect(detailBody.conversation.clientUsername).toBe(`conv_client_${uniqueSuffix}`);

    const notFoundRes = await app.handle(
      new Request('http://localhost/api/v1/conversations/999999999', {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(notFoundRes.status).toBe(404);
  });

  it('GET /api/v1/conversations/:id/messages returns messages in chronological order', async () => {
    const uniqueSuffix = `${Date.now()}_msgs`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `msg_client_${uniqueSuffix}`,
      displayName: 'Message Client',
    });
    createdClientIds.push(client.id);

    const conv = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_msgs_${uniqueSuffix}`,
    });
    createdConversationIds.push(conv.id);

    await insertMessagesIfNew(conv.id, [
      {
        externalId: `msg_${uniqueSuffix}_1`,
        direction: 'inbound',
        senderType: 'client',
        senderName: 'Message Client',
        content: 'First message',
        sentAt: new Date(Date.now() - 10000),
      },
      {
        externalId: `msg_${uniqueSuffix}_2`,
        direction: 'outbound',
        senderType: 'creator',
        senderName: 'Creator',
        content: 'Second message',
        sentAt: new Date(Date.now() - 5000),
      },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/conversations/${conv.id}/messages`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toBeArray();
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].content).toBe('First message');
    expect(body.messages[1].content).toBe('Second message');
  });

  it('GET /api/v1/audit-log returns immutable audit trail', async () => {
    const uniqueSuffix = `${Date.now()}_audit`;
    const log = await insertAuditLog({
      userId: ownerId,
      actorType: 'user',
      action: 'TEST_AUDIT_ACTION',
      targetType: 'commission',
      targetId: 12345,
      metadata: { key: uniqueSuffix },
    });
    createdAuditLogIds.push(log.id);

    const res = await app.handle(
      new Request('http://localhost/api/v1/audit-log', {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.auditLogs).toBeArray();
    const found = body.auditLogs.find((l: { id: number }) => l.id === log.id);
    expect(found).toBeDefined();
    expect(found.action).toBe('TEST_AUDIT_ACTION');
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const endpoints = [
      { path: '/api/v1/commissions', method: 'GET' },
      { path: '/api/v1/commissions/1', method: 'GET' },
      { path: '/api/v1/commissions/1', method: 'PATCH' },
      { path: '/api/v1/clients', method: 'GET' },
      { path: '/api/v1/clients/1', method: 'GET' },
      { path: '/api/v1/conversations', method: 'GET' },
      { path: '/api/v1/conversations/1', method: 'GET' },
      { path: '/api/v1/conversations/1/messages', method: 'GET' },
      { path: '/api/v1/audit-log', method: 'GET' },
    ];

    for (const ep of endpoints) {
      const res = await app.handle(
        new Request(`http://localhost${ep.path}`, {
          method: ep.method,
          headers: ep.method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
          body: ep.method === 'PATCH' ? JSON.stringify({ status: 'in_progress' }) : undefined,
        })
      );
      expect(res.status).toBe(401);
    }
  });

  it('handles descending order for messages', async () => {
    const uniqueSuffix = `${Date.now()}_desc_msgs`;
    const client = await upsertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `msg_desc_client_${uniqueSuffix}`,
      displayName: 'Desc Msg Client',
    });
    createdClientIds.push(client.id);

    const conv = await upsertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_desc_msgs_${uniqueSuffix}`,
    });
    createdConversationIds.push(conv.id);

    await insertMessagesIfNew(conv.id, [
      {
        externalId: `msg_${uniqueSuffix}_1`,
        direction: 'inbound',
        senderType: 'client',
        senderName: 'Client',
        content: 'Older message',
        sentAt: new Date(Date.now() - 20000),
      },
      {
        externalId: `msg_${uniqueSuffix}_2`,
        direction: 'outbound',
        senderType: 'creator',
        senderName: 'Creator',
        content: 'Newer message',
        sentAt: new Date(Date.now() - 10000),
      },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/conversations/${conv.id}/messages?order=desc`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0].content).toBe('Newer message');
    expect(body.messages[1].content).toBe('Older message');
  });

  it('returns 404 for messages of non-existent conversation', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/conversations/999999999/messages', {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(res.status).toBe(404);
  });
});
