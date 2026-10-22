import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { createHash } from 'node:crypto';
import { inArray, eq, and } from 'drizzle-orm';
import {
  db,
  clients,
  commissions,
  conversations,
  messages as messagesTable,
  drafts as draftsTable,
  approvals,
  agentTasks,
  auditLogs,
  getOwnerUserId,
  getDraftById,
  getApprovalsByDraftId,
  getTaskById,
  insertClient,
  insertConversation,
  upsertCommission,
  insertMessagesIfNew,
  getMessagesByConversationId,
} from '@client-agent/db';
import {
  AuditAction,
  DraftStatus,
  CommissionStatus,
  TaskType,
  TaskStatus,
  ApprovalAction,
  ApprovalStatus,
} from '@client-agent/domain';
import { config } from '@client-agent/config';
import { VGenBrowserAdapter } from '@client-agent/vgen';
import type { DiscordMessenger } from '@client-agent/discord';
import { handleSendVgenMessage } from '../apps/worker/src/handlers/sendVgenMessage';
import { app } from '../apps/api/src/app';
import { ApiClient } from '../apps/web/src/lib/api';

interface MockPageOptions {
  creatorUsername?: string;
  verifiedBubbleText?: string;
  messageId?: string;
}

function createMockPage(options: MockPageOptions = {}) {
  let currentUrl = 'https://vgen.co/creator';
  let typedContent = '';
  let sendClicked = false;

  const creator = options.creatorUsername ?? (process.env.VGEN_CREATOR_USERNAME || 'r1daz_');

  const mockPage: any = {
    url: () => currentUrl,
    goto: async (url: string) => {
      currentUrl = url;
    },
    reload: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    locator: (selector: string) => {
      const isProfile =
        selector.includes('user-username') ||
        selector.includes('creator') ||
        selector.includes('alt') ||
        selector.includes('Profile');
      const isThread =
        selector.includes('thread-message') ||
        selector.includes('str-chat__message');

      return {
        first: () => ({
          waitFor: async () => {},
          isVisible: async () => true,
          innerText: async () => (isProfile ? creator : ''),
          getAttribute: async (attr: string) => {
            if (attr === 'data-username' || attr === 'alt') return creator;
            return null;
          },
          fill: async (val: string) => {
            typedContent = val;
          },
          click: async () => {
            sendClicked = true;
          },
          press: async () => {
            sendClicked = true;
          },
        }),
        last: () => ({
          waitFor: async () => {},
          innerText: async () => {
            if (isThread) {
              return options.verifiedBubbleText ?? typedContent;
            }
            return '';
          },
          getAttribute: async (attr: string) => {
            if (attr === 'data-message-id' || attr === 'id') {
              return options.messageId ?? `vgen-msg-${Date.now()}`;
            }
            return null;
          },
        }),
        all: async () => [],
      };
    },
    getTypedContent: () => typedContent,
    wasSendClicked: () => sendClicked,
  };

  return mockPage;
}

describe('Phase 7 Dashboard End-to-End System Integration', () => {
  const timestamp = Date.now();
  let ownerId: number;
  let cookieHeader: string;
  let testClientId: number;
  let testConversationId: number;
  let testCommissionId: number;
  let webApiClient: ApiClient;

  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdCommissionIds: number[] = [];
  const createdDraftIds: number[] = [];
  const createdTaskIds: number[] = [];
  const sentDiscordMessages: string[] = [];

  const mockMessenger: DiscordMessenger = {
    editInteractionFollowup: async () => ({ messageId: null }),
    sendChannelMessage: async (_channelId: string, text: string) => {
      sentDiscordMessages.push(text);
      return { messageId: `discord-msg-${Date.now()}` };
    },
  };

  beforeAll(async () => {
    ownerId = await getOwnerUserId();

    // 1. Setup base test Client, Conversation, and Commission
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `dash_e2e_client_${timestamp}`,
      displayName: 'E2E Dashboard Client',
    });
    testClientId = client.id;
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `dash_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/dash_conv_${timestamp}`,
    });
    testConversationId = conv.id;
    createdConversationIds.push(conv.id);

    const comm = await upsertCommission({
      clientId: client.id,
      externalId: `comm_e2e_${timestamp}`,
      serviceName: 'Custom Live2D Rigging',
      amount: '750.00',
      currency: 'USD',
      status: CommissionStatus.IN_PROGRESS,
      metadata: { notes: 'E2E Full Dashboard Verification Order' },
    });
    testCommissionId = comm.id;
    createdCommissionIds.push(comm.id);

    // Seed initial inbound client message
    await insertMessagesIfNew(conv.id, [
      {
        externalId: `dash_msg_${timestamp}`,
        direction: 'inbound',
        senderType: 'client',
        senderName: 'E2E Dashboard Client',
        content: 'Hi! Checking in on the Live2D rigging status.',
        sentAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    // Teardown in safe foreign-key dependency order
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
        .delete(agentTasks)
        .where(inArray(agentTasks.id, createdTaskIds));
    }

    if (createdCommissionIds.length > 0) {
      await db
        .delete(commissions)
        .where(inArray(commissions.id, createdCommissionIds));
    }

    if (createdConversationIds.length > 0) {
      await db
        .delete(messagesTable)
        .where(inArray(messagesTable.conversationId, createdConversationIds));
      await db
        .delete(draftsTable)
        .where(inArray(draftsTable.conversationId, createdConversationIds));
      await db
        .delete(conversations)
        .where(inArray(conversations.id, createdConversationIds));
    } else if (createdDraftIds.length > 0) {
      await db
        .delete(draftsTable)
        .where(inArray(draftsTable.id, createdDraftIds));
    }

    if (createdClientIds.length > 0) {
      await db.delete(clients).where(inArray(clients.id, createdClientIds));
    }
  });

  // Step 1: Authentication & Session Verification
  it('authenticates creator via POST /api/v1/auth/login and establishes secure session', async () => {
    // 1a: Negative: Invalid credentials rejected
    const invalidRes = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.AUTH_USERNAME,
          password: 'incorrect_password_attempt',
        }),
      }),
    );
    expect(invalidRes.status).toBe(401);
    const invalidBody = await invalidRes.json();
    expect(invalidBody.error.code).toBe('INVALID_CREDENTIALS');

    // 1b: Positive: Valid credentials authenticate successfully
    const validRes = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.AUTH_USERNAME,
          password: 'admin123',
        }),
      }),
    );
    expect(validRes.status).toBe(200);

    const setCookie = validRes.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('session=');

    const sessionMatch = setCookie!.match(/session=([^;]+)/);
    expect(sessionMatch).not.toBeNull();
    const sessionId = sessionMatch![1];
    cookieHeader = `session=${sessionId}`;

    const body = await validRes.json();
    expect(body.user).toBeDefined();
    expect(body.user.name).toBe(config.AUTH_USERNAME);

    // 1c: Verify GET /api/v1/auth/me returns authenticated creator
    const meRes = await app.handle(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.user.name).toBe(config.AUTH_USERNAME);

    // Initialize ApiClient instance with cookie forwarding for downstream frontend verification
    webApiClient = new ApiClient({
      baseUrl: 'http://localhost',
      fetch: (async (url: any, init?: any) => {
        const headers = new Headers(init?.headers);
        headers.set('Cookie', cookieHeader);
        return app.handle(
          new Request(url, {
            ...init,
            headers,
          }),
        );
      }) as unknown as typeof fetch,
    });
  });

  // Step 2: Dashboard Overview & Pipeline Metrics
  it('fetches GET /api/v1/dashboard/summary and asserts pipeline metrics and active commissions', async () => {
    // Unauthenticated request should be rejected
    const unauthRes = await app.handle(
      new Request('http://localhost/api/v1/dashboard/summary'),
    );
    expect(unauthRes.status).toBe(401);

    // Authenticated request
    const summaryRes = await app.handle(
      new Request('http://localhost/api/v1/dashboard/summary', {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(summaryRes.status).toBe(200);

    const data = await summaryRes.json();
    expect(data.metrics).toBeDefined();
    expect(data.metrics.activeCount).toBeGreaterThanOrEqual(1);
    expect(typeof data.metrics.inQueueCount).toBe('number');
    expect(typeof data.metrics.completedMonthCount).toBe('number');
    expect(typeof data.metrics.pendingDraftCount).toBe('number');

    // Commission pipeline assertion
    expect(Array.isArray(data.commissions)).toBe(true);
    const foundCommission = data.commissions.find(
      (c: any) => c.id === testCommissionId,
    );
    expect(foundCommission).toBeDefined();
    expect(foundCommission.serviceName).toBe('Custom Live2D Rigging');
    expect(foundCommission.amount).toBe('750.00');
    expect(foundCommission.clientUsername).toBe(`dash_e2e_client_${timestamp}`);

    // Recent messages assertion
    expect(Array.isArray(data.recentMessages)).toBe(true);
    const foundMessage = data.recentMessages.find(
      (m: any) => m.conversationId === testConversationId,
    );
    expect(foundMessage).toBeDefined();
    expect(foundMessage.content).toContain('Live2D rigging');
  });

  // Step 3: Complete Draft Lifecycle, Approvals, and Safety Gate Invalidation
  let activeDraftId: number;
  const initialContent = 'Hello! Working on physics rigging, preview will be ready Friday.';
  const editedContent = 'Hello! Working on physics rigging, preview ready by tomorrow 5 PM UTC.';
  const reEditedContent = 'Hello! Rigging finished, invoice attached for review.';

  it('manages draft lifecycle: create -> list -> edit -> approve -> invalidate on edit -> re-approve', async () => {
    // 3a: Create draft via POST /api/v1/drafts
    const createDraftRes = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          conversationId: testConversationId,
          content: initialContent,
        }),
      }),
    );
    expect(createDraftRes.status).toBe(201);
    const createBody = await createDraftRes.json();
    expect(createBody.draft).toBeDefined();
    expect(createBody.draft.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(createBody.draft.content).toBe(initialContent);

    activeDraftId = createBody.draft.id;
    createdDraftIds.push(activeDraftId);

    // 3b: List drafts via GET /api/v1/drafts
    const listDraftsRes = await app.handle(
      new Request('http://localhost/api/v1/drafts?status=pending_approval', {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(listDraftsRes.status).toBe(200);
    const listBody = await listDraftsRes.json();
    const foundInList = listBody.drafts.find((d: any) => d.id === activeDraftId);
    expect(foundInList).toBeDefined();
    expect(foundInList.content).toBe(initialContent);

    // 3c: Update draft via PATCH /api/v1/drafts/:id
    const editRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${activeDraftId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ content: editedContent }),
      }),
    );
    expect(editRes.status).toBe(200);
    const editBody = await editRes.json();
    expect(editBody.draft.content).toBe(editedContent);
    expect(editBody.draft.status).toBe(DraftStatus.PENDING_APPROVAL);

    // 3d: Approve draft via POST /api/v1/drafts/:id/approve
    const approveRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${activeDraftId}/approve`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.draft.status).toBe(DraftStatus.APPROVED);
    expect(approveBody.draft.approvedBy).toBe(ownerId);
    expect(approveBody.draft.approvedAt).not.toBeNull();

    // Verify approval record in DB
    const expectedHash = createHash('sha256').update(editedContent).digest('hex');
    const approvalsInDb = await getApprovalsByDraftId(activeDraftId);
    expect(approvalsInDb).toHaveLength(1);
    expect(approvalsInDb[0]!.action).toBe(ApprovalAction.APPROVE);
    expect(approvalsInDb[0]!.status).toBe(ApprovalStatus.ACTIVE);
    expect(approvalsInDb[0]!.contentHash).toBe(expectedHash);

    // Verify USER_APPROVED_DRAFT audit log created
    const approveAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, activeDraftId),
          eq(auditLogs.action, AuditAction.USER_APPROVED_DRAFT),
        ),
      );
    expect(approveAudits.length).toBeGreaterThanOrEqual(1);

    // 3e: Edit after approval must invalidate active approval and revert status to pending_approval
    const reEditRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${activeDraftId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ content: reEditedContent }),
      }),
    );
    expect(reEditRes.status).toBe(200);
    const reEditBody = await reEditRes.json();
    expect(reEditBody.draft.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(reEditBody.draft.approvedBy).toBeNull();
    expect(reEditBody.draft.approvedAt).toBeNull();
    expect(reEditBody.draft.content).toBe(reEditedContent);

    // Verify prior approval was revoked
    const approvalsAfterReEdit = await getApprovalsByDraftId(activeDraftId);
    expect(approvalsAfterReEdit.length).toBeGreaterThanOrEqual(1);
    expect(approvalsAfterReEdit.some((a) => a.status === ApprovalStatus.REVOKED)).toBe(true);

    // Verify USER_EDITED_DRAFT audit log recorded
    const editAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, activeDraftId),
          eq(auditLogs.action, AuditAction.USER_EDITED_DRAFT),
        ),
      );
    expect(editAudits.length).toBeGreaterThanOrEqual(1);

    // 3f: Re-approve draft before sending
    const reApproveRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${activeDraftId}/approve`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(reApproveRes.status).toBe(200);
    const reApproveBody = await reApproveRes.json();
    expect(reApproveBody.draft.status).toBe(DraftStatus.APPROVED);
  });

  // Step 4: Safety Gate Enforced VGen Send & Audit Log
  it('dispatches approved draft via POST /api/v1/drafts/:id/send and verifies SEND_VGEN_MESSAGE task and audit logs', async () => {
    // 4a: Negative check: Unapproved draft cannot be sent (HTTP 409 NOT_APPROVED)
    const unapprovedDraft = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `dash_unapproved_${timestamp}`,
    }).then(async (c) => {
      createdClientIds.push(c.id);
      const conv = await insertConversation({
        clientId: c.id,
        platform: 'vgen',
        externalId: `unapproved_conv_${timestamp}`,
      });
      createdConversationIds.push(conv.id);
      const draft = await app.handle(
        new Request('http://localhost/api/v1/drafts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            conversationId: conv.id,
            content: 'Not approved draft message',
          }),
        }),
      );
      const body = await draft.json();
      createdDraftIds.push(body.draft.id);
      return body.draft;
    });

    const rejectSendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${unapprovedDraft.id}/send`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(rejectSendRes.status).toBe(409);
    const rejectBody = await rejectSendRes.json();
    expect(rejectBody.error.code).toBe('NOT_APPROVED');

    // 4b: Positive check: Approved draft dispatches with HTTP 202 Accepted
    const sendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${activeDraftId}/send`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(sendRes.status).toBe(202);
    const sendBody = await sendRes.json();
    expect(sendBody.taskId).toBeDefined();
    expect(sendBody.status).toBe('queued');

    const taskId = Number(sendBody.taskId);
    createdTaskIds.push(taskId);

    // Verify task record created in PostgreSQL agent_tasks table
    const taskInDb = await getTaskById(taskId);
    expect(taskInDb).not.toBeNull();
    expect(taskInDb!.type).toBe(TaskType.SEND_VGEN_MESSAGE);
    expect(taskInDb!.status).toBe(TaskStatus.QUEUED);
    expect((taskInDb!.input as any).draftId).toBe(activeDraftId);

    // 4c: Execute worker handler with mock browser adapter to simulate the 7 safety checks and message dispatch
    const mockPage = createMockPage({
      creatorUsername: process.env.VGEN_CREATOR_USERNAME || 'r1daz_',
      verifiedBubbleText: reEditedContent,
    });

    const adapter = new VGenBrowserAdapter({
      createPage: async () => mockPage as any,
      closePage: async () => {},
    });

    const workerResult = await handleSendVgenMessage(
      {
        id: `stream-msg-${taskId}`,
        data: {
          taskId: String(taskId),
          draftId: String(activeDraftId),
          userId: String(ownerId),
        },
      },
      {
        adapter,
        messenger: mockMessenger,
        channelId: 'test-dash-channel',
      },
    );

    expect(workerResult.success).toBe(true);

    // Verify task completion
    const completedTask = await getTaskById(taskId);
    expect(completedTask!.status).toBe(TaskStatus.COMPLETED);

    // Verify draft status transitioned to SENT
    const sentDraft = await getDraftById(activeDraftId);
    expect(sentDraft!.status).toBe(DraftStatus.SENT);
    expect(sentDraft!.sentAt).not.toBeNull();

    // Verify outbound message was inserted into conversation
    const convMsgs = await getMessagesByConversationId(testConversationId);
    const outbound = convMsgs.filter((m) => m.direction === 'outbound');
    expect(outbound.length).toBeGreaterThanOrEqual(1);
    expect(outbound[0]!.content).toBe(reEditedContent);

    // 4d: Verify immutable audit log recorded for MESSAGE_SENT
    const messageSentAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, activeDraftId),
          eq(auditLogs.action, AuditAction.MESSAGE_SENT),
        ),
      );
    expect(messageSentAudits).toHaveLength(1);
    expect(messageSentAudits[0]!.actorType).toBe('agent');
  });

  // Step 5: Immutable Audit Log Endpoints
  it('queries GET /api/v1/audit-log and verifies immutable audit trails', async () => {
    const auditRes = await app.handle(
      new Request('http://localhost/api/v1/audit-log?targetType=draft', {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    expect(Array.isArray(auditBody.auditLogs)).toBe(true);

    const relevantLogs = auditBody.auditLogs.filter(
      (log: any) => log.targetId === activeDraftId,
    );
    expect(relevantLogs.length).toBeGreaterThanOrEqual(2);

    const actions = relevantLogs.map((l: any) => l.action);
    expect(actions).toContain(AuditAction.USER_APPROVED_DRAFT);
    expect(actions).toContain(AuditAction.MESSAGE_SENT);
  });

  // Step 6: Clients and Commissions Endpoints
  it('manages clients and commissions via REST API endpoints', async () => {
    // 6a: List clients and verify search filtering
    const clientsRes = await app.handle(
      new Request(`http://localhost/api/v1/clients?search=dash_e2e_client_${timestamp}`, {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(clientsRes.status).toBe(200);
    const clientsBody = await clientsRes.json();
    expect(clientsBody.clients.length).toBeGreaterThanOrEqual(1);
    expect(clientsBody.clients[0].username).toBe(`dash_e2e_client_${timestamp}`);

    // 6b: Get specific client by ID
    const clientDetailRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}`, {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(clientDetailRes.status).toBe(200);
    const clientDetailBody = await clientDetailRes.json();
    expect(clientDetailBody.client.id).toBe(testClientId);
    expect(clientDetailBody.client.displayName).toBe('E2E Dashboard Client');

    // 6c: List commissions and filter by status
    const commsRes = await app.handle(
      new Request('http://localhost/api/v1/commissions?status=in_progress', {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(commsRes.status).toBe(200);
    const commsBody = await commsRes.json();
    const foundComm = commsBody.commissions.find((c: any) => c.id === testCommissionId);
    expect(foundComm).toBeDefined();
    expect(foundComm.serviceName).toBe('Custom Live2D Rigging');

    // 6d: Get single commission by ID
    const singleCommRes = await app.handle(
      new Request(`http://localhost/api/v1/commissions/${testCommissionId}`, {
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(singleCommRes.status).toBe(200);
    const singleCommBody = await singleCommRes.json();
    expect(singleCommBody.commission.id).toBe(testCommissionId);

    // 6e: Update commission status via PATCH /api/v1/commissions/:id
    const patchCommRes = await app.handle(
      new Request(`http://localhost/api/v1/commissions/${testCommissionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          status: CommissionStatus.COMPLETED,
          amount: '800.00',
        }),
      }),
    );
    expect(patchCommRes.status).toBe(200);
    const patchCommBody = await patchCommRes.json();
    expect(patchCommBody.commission.status).toBe(CommissionStatus.COMPLETED);
    expect(patchCommBody.commission.amount).toBe('800.00');
  });

  // Step 7: Web Frontend ApiClient Typed SDK Verification
  it('verifies typed ApiClient methods used by SvelteKit dashboard components', async () => {
    // 7a: Dashboard summary via ApiClient
    const summary = await webApiClient.getDashboardSummary();
    expect(summary.metrics).toBeDefined();
    expect(typeof summary.metrics.activeCount).toBe('number');
    expect(Array.isArray(summary.commissions)).toBe(true);

    // 7b: Clients directory via ApiClient
    const clientsResult = await webApiClient.listClients({ search: `dash_e2e_client_${timestamp}` });
    expect(clientsResult.length).toBeGreaterThanOrEqual(1);

    const clientDetail = await webApiClient.getClient(testClientId);
    expect(clientDetail.id).toBe(testClientId);

    // 7c: Commissions board via ApiClient
    const commsResult = await webApiClient.listCommissions({ clientId: testClientId });
    expect(commsResult.length).toBeGreaterThanOrEqual(1);
    expect(commsResult[0]!.id).toBe(testCommissionId);

    // 7d: Drafts management via ApiClient
    const draftsResult = await webApiClient.listDrafts({ conversationId: testConversationId });
    expect(draftsResult.length).toBeGreaterThanOrEqual(1);
    const draftDetail = await webApiClient.getDraft(activeDraftId);
    expect(draftDetail.draft.id).toBe(activeDraftId);

    // 7e: Audit logs via ApiClient
    const auditLogsResult = await webApiClient.listAuditLogs({ targetType: 'draft' });
    expect(auditLogsResult.length).toBeGreaterThanOrEqual(1);
  });
});
