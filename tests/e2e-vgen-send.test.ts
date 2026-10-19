import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { inArray, eq, and } from 'drizzle-orm';
import {
  db,
  drafts as draftsTable,
  approvals,
  auditLogs,
  agentTasks,
  clients,
  conversations,
  messages as messagesTable,
  getDraftById,
  getTaskById,
  getOwnerUserId,
  insertClient,
  insertConversation,
  insertDraft,
  insertMessagesIfNew,
  getMessagesByConversationId,
  draftService,
} from '@client-agent/db';
import {
  AuditAction,
  DraftStatus,
  TaskStatus,
} from '@client-agent/domain';
import { STREAMS, createRedisClient, NonRetriableError } from '@client-agent/queue';
import { VGenBrowserAdapter } from '@client-agent/vgen';
import type { DiscordMessenger } from '@client-agent/discord';
import { handleSendVgenMessage } from '../apps/worker/src/handlers/sendVgenMessage';
import { app } from '../apps/api/src/app';

interface MockPageOptions {
  creatorUsername?: string;
  simulateSendTimeout?: boolean;
  recoveredBubbles?: Array<{ text: string; id?: string }>;
  verifiedBubbleText?: string;
  messageId?: string;
  onFill?: (text: string) => void;
  onClickSend?: () => void;
}

function createMockPage(options: MockPageOptions = {}) {
  let currentUrl = 'https://vgen.co/creator';
  let typedContent = '';
  let sendClicked = false;
  let reloaded = false;

  const mockPage: any = {
    url: () => currentUrl,
    goto: async (url: string) => {
      currentUrl = url;
    },
    reload: async () => {
      reloaded = true;
    },
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
          innerText: async () => {
            if (isProfile) return options.creatorUsername ?? 'r1daz_';
            return '';
          },
          getAttribute: async (attr: string) => {
            if (attr === 'data-username' || attr === 'alt') return options.creatorUsername ?? 'r1daz_';
            return null;
          },
          fill: async (val: string) => {
            typedContent = val;
            options.onFill?.(val);
          },
          click: async () => {
            sendClicked = true;
            options.onClickSend?.();
            if (options.simulateSendTimeout) {
              throw new Error('Network timeout during send');
            }
          },
          press: async () => {
            sendClicked = true;
            options.onClickSend?.();
            if (options.simulateSendTimeout) {
              throw new Error('Network timeout during send');
            }
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
        all: async () => {
          if (isThread && options.recoveredBubbles) {
            return options.recoveredBubbles.map((b) => ({
              innerText: async () => b.text,
              getAttribute: async (attr: string) =>
                attr === 'data-message-id' ? b.id ?? 'msg-rec' : null,
              evaluate: async () => b.text,
            }));
          }
          return [];
        },
      };
    },
    getTypedContent: () => typedContent,
    wasSendClicked: () => sendClicked,
    wasReloaded: () => reloaded,
  };

  return mockPage;
}

describe('Phase 6 VGen Send End-to-End Integration Tests', () => {
  const redis = createRedisClient();
  const createdClientIds: number[] = [];
  const createdConversationIds: number[] = [];
  const createdTaskIds: number[] = [];
  const createdDraftIds: number[] = [];
  const sentDiscordMessages: string[] = [];

  let ownerId: number;

  const mockMessenger: DiscordMessenger = {
    editInteractionFollowup: async () => ({ messageId: null }),
    sendChannelMessage: async (_channelId: string, text: string) => {
      sentDiscordMessages.push(text);
      return { messageId: `discord-msg-${Date.now()}` };
    },
  };

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
  });

  afterAll(async () => {
    // Teardown created DB rows in strict foreign key order
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

    redis.disconnect();
  });

  // Scenario 1: Negative: POST /drafts/:id/send on unapproved draft returns 409
  it('Scenario 1: returns 409 Conflict when attempting to send an unapproved draft', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_sc1_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `sc1_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/sc1_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Hey there! Draft message still waiting for review.',
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('NOT_APPROVED');
    expect(body.error.message).toBe('Draft must be approved before sending');

    // DB verification: draft status remains pending_approval
    const draftInDb = await getDraftById(draft.id);
    expect(draftInDb).not.toBeNull();
    expect(draftInDb!.status).toBe(DraftStatus.PENDING_APPROVAL);
  });

  // Scenario 2: Negative: Tampered content after approval -> safety gate fails Check 5, logs MESSAGE_SEND_ABORTED_SAFETY_CHECK, task marked DEAD
  it('Scenario 2: aborts send and marks task DEAD when draft content is tampered after approval (Check 5)', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_sc2_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `sc2_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/sc2_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    const originalContent = 'Original agreed fee is $150.';
    const draft = await insertDraft({
      conversationId: conv.id,
      content: originalContent,
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    // Creator approves draft (approval record gets hash of originalContent)
    await draftService.approveDraft({ draftId: draft.id, userId: ownerId });

    // Simulate tampering with draft content directly in DB after approval
    const tamperedContent = 'Malicious tampered fee is $10.';
    await db
      .update(draftsTable)
      .set({ content: tamperedContent })
      .where(eq(draftsTable.id, draft.id));

    // Send triggered via API
    const sendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(sendRes.status).toBe(202);
    const sendBody = await sendRes.json();
    const taskId = Number(sendBody.taskId);
    createdTaskIds.push(taskId);

    const mockPage = createMockPage({ creatorUsername: 'r1daz_' });
    const adapter = new VGenBrowserAdapter({
      createPage: async () => mockPage as any,
      closePage: async () => {},
    });

    // Worker executes task
    let caughtError: any = null;
    try {
      await handleSendVgenMessage(
        {
          id: `stream-msg-${taskId}`,
          data: { taskId: String(taskId), draftId: String(draft.id), userId: String(ownerId) },
        },
        {
          adapter,
          messenger: mockMessenger,
          channelId: 'test-channel',
        },
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(NonRetriableError);
    expect(caughtError.message).toContain('Check 5 Failed');

    // Task in DB is marked DEAD
    const taskInDb = await getTaskById(taskId);
    expect(taskInDb!.status).toBe(TaskStatus.DEAD);
    expect(taskInDb!.error).toContain('Check 5 Failed');

    // Draft is NOT marked sent
    const draftInDb = await getDraftById(draft.id);
    expect(draftInDb!.status).toBe(DraftStatus.APPROVED);
    expect(draftInDb!.sentAt).toBeNull();

    // Audit log records MESSAGE_SEND_ABORTED_SAFETY_CHECK with failedCheck 5
    const auditEntries = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draft.id),
          eq(auditLogs.action, AuditAction.MESSAGE_SEND_ABORTED_SAFETY_CHECK),
        ),
      );
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]!.metadata).toMatchObject({ failedCheck: 5 });

    // Discord alert sent
    expect(
      sentDiscordMessages.some(
        (msg) => msg.includes('🛑 Safety check blocked send') && msg.includes('Check 5'),
      ),
    ).toBe(true);

    // No outbound messages in conversation
    const msgs = await getMessagesByConversationId(conv.id);
    expect(msgs).toHaveLength(0);
  });

  // Scenario 3: Negative: Stale draft (inbound client message received after draft created) -> safety gate fails Check 7
  it('Scenario 3: aborts send and marks task DEAD when new inbound client message arrives after draft creation (Check 7)', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_sc3_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `sc3_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/sc3_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'We will begin with Option A as discussed.',
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    await draftService.approveDraft({ draftId: draft.id, userId: ownerId });

    // Insert an inbound message received AFTER draft was generated
    const draftInDbBefore = await getDraftById(draft.id);
    const newerDate = new Date(draftInDbBefore!.createdAt.getTime() + 15_000);
    await insertMessagesIfNew(conv.id, [
      {
        externalId: `sc3_inbound_${timestamp}`,
        direction: 'inbound',
        senderType: 'client',
        senderName: client.username,
        content: 'Wait! Can we switch to Option B instead?',
        sentAt: newerDate,
      },
    ]);

    // Send triggered via API
    const sendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(sendRes.status).toBe(202);
    const sendBody = await sendRes.json();
    const taskId = Number(sendBody.taskId);
    createdTaskIds.push(taskId);

    const mockPage = createMockPage({ creatorUsername: 'r1daz_' });
    const adapter = new VGenBrowserAdapter({
      createPage: async () => mockPage as any,
      closePage: async () => {},
    });

    let caughtError: any = null;
    try {
      await handleSendVgenMessage(
        {
          id: `stream-msg-${taskId}`,
          data: { taskId: String(taskId), draftId: String(draft.id), userId: String(ownerId) },
        },
        {
          adapter,
          messenger: mockMessenger,
          channelId: 'test-channel',
        },
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(NonRetriableError);
    expect(caughtError.message).toContain('Check 7 Failed');

    // Task in DB is marked DEAD
    const taskInDb = await getTaskById(taskId);
    expect(taskInDb!.status).toBe(TaskStatus.DEAD);
    expect(taskInDb!.error).toContain('Check 7 Failed');

    // Draft is NOT marked sent
    const draftInDb = await getDraftById(draft.id);
    expect(draftInDb!.status).toBe(DraftStatus.APPROVED);
    expect(draftInDb!.sentAt).toBeNull();

    // Audit log has MESSAGE_SEND_ABORTED_SAFETY_CHECK with failedCheck 7
    const auditEntries = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draft.id),
          eq(auditLogs.action, AuditAction.MESSAGE_SEND_ABORTED_SAFETY_CHECK),
        ),
      );
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]!.metadata).toMatchObject({ failedCheck: 7 });

    // Discord alert sent
    expect(
      sentDiscordMessages.some(
        (msg) => msg.includes('🛑 Safety check blocked send') && msg.includes('Check 7'),
      ),
    ).toBe(true);

    // No outbound messages inserted
    const convMsgs = await getMessagesByConversationId(conv.id);
    const outbound = convMsgs.filter((m) => m.direction === 'outbound');
    expect(outbound).toHaveLength(0);
  });

  // Scenario 4: Ambiguous recovery: Timeout during send -> re-reads thread DOM -> detects message sent -> completes without double send
  it('Scenario 4: recovers when timeout occurs during send and message is detected in DOM on reload', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_sc4_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `sc4_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/sc4_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    const draftContent = 'Invoice for sketch review attached.';
    const draft = await insertDraft({
      conversationId: conv.id,
      content: draftContent,
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    await draftService.approveDraft({ draftId: draft.id, userId: ownerId });

    // Send triggered via API
    const sendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(sendRes.status).toBe(202);
    const sendBody = await sendRes.json();
    const taskId = Number(sendBody.taskId);
    createdTaskIds.push(taskId);

    // Mock page: times out on send button click, but recovery DOM inspection finds the message!
    const mockPage = createMockPage({
      creatorUsername: 'r1daz_',
      simulateSendTimeout: true,
      recoveredBubbles: [{ text: draftContent, id: 'recovered-msg-4' }],
    });

    const adapter = new VGenBrowserAdapter({
      createPage: async () => mockPage as any,
      closePage: async () => {},
    });

    const output = await handleSendVgenMessage(
      {
        id: `stream-msg-${taskId}`,
        data: { taskId: String(taskId), draftId: String(draft.id), userId: String(ownerId) },
      },
      {
        adapter,
        messenger: mockMessenger,
        channelId: 'test-channel',
      },
    );

    // Verify recovery output
    expect(output.success).toBe(true);
    expect(output.messageId).toContain('vgen_recovered_');
    expect(mockPage.wasReloaded()).toBe(true);

    // Task is marked COMPLETED
    const taskInDb = await getTaskById(taskId);
    expect(taskInDb!.status).toBe(TaskStatus.COMPLETED);

    // Draft is marked SENT
    const draftInDb = await getDraftById(draft.id);
    expect(draftInDb!.status).toBe(DraftStatus.SENT);
    expect(draftInDb!.sentAt).not.toBeNull();

    // Exactly one outbound message inserted in DB (no double send!)
    const convMsgs = await getMessagesByConversationId(conv.id);
    const outbound = convMsgs.filter((m) => m.direction === 'outbound');
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.content).toBe(draftContent);
    expect(outbound[0]!.senderType).toBe('creator');
    expect(outbound[0]!.senderName).toBe('r1daz_');

    // Audit log has MESSAGE_SENT
    const sentAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draft.id),
          eq(auditLogs.action, AuditAction.MESSAGE_SENT),
        ),
      );
    expect(sentAudits).toHaveLength(1);

    // Discord alert sent
    expect(
      sentDiscordMessages.some((msg) => msg.includes('🚀 Message successfully delivered')),
    ).toBe(true);
  });

  // Scenario 5: Ambiguous failure: Timeout during send -> re-reads thread DOM -> message absent -> throws SendAmbiguousError, marks task DEAD, never retries blindly
  it('Scenario 5: throws SendAmbiguousError and marks task DEAD when send times out and message is absent on reload', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_sc5_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `sc5_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/sc5_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Checking revision status with you.',
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    await draftService.approveDraft({ draftId: draft.id, userId: ownerId });

    // Send triggered via API
    const sendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(sendRes.status).toBe(202);
    const sendBody = await sendRes.json();
    const taskId = Number(sendBody.taskId);
    createdTaskIds.push(taskId);

    // Mock page: times out, and message is ABSENT in recovery DOM
    const mockPage = createMockPage({
      creatorUsername: 'r1daz_',
      simulateSendTimeout: true,
      recoveredBubbles: [], // empty -> absent
    });

    const adapter = new VGenBrowserAdapter({
      createPage: async () => mockPage as any,
      closePage: async () => {},
    });

    let caughtError: any = null;
    try {
      await handleSendVgenMessage(
        {
          id: `stream-msg-${taskId}`,
          data: { taskId: String(taskId), draftId: String(draft.id), userId: String(ownerId) },
        },
        {
          adapter,
          messenger: mockMessenger,
          channelId: 'test-channel',
        },
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(NonRetriableError);
    expect(mockPage.wasReloaded()).toBe(true);

    // Task marked DEAD so queue runner never retries blindly
    const taskInDb = await getTaskById(taskId);
    expect(taskInDb!.status).toBe(TaskStatus.DEAD);
    expect(taskInDb!.error).toContain('Ambiguous send');

    // Draft remains approved, NOT sent
    const draftInDb = await getDraftById(draft.id);
    expect(draftInDb!.status).toBe(DraftStatus.APPROVED);
    expect(draftInDb!.sentAt).toBeNull();

    // Audit log records MESSAGE_SEND_FAILED with ambiguous: true
    const failedAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draft.id),
          eq(auditLogs.action, AuditAction.MESSAGE_SEND_FAILED),
        ),
      );
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0]!.metadata).toMatchObject({ ambiguous: true });

    // Discord alert sent warning about ambiguous send
    expect(
      sentDiscordMessages.some(
        (msg) => msg.includes('AMBIGUOUS') && msg.includes('Please inspect VGen manually'),
      ),
    ).toBe(true);

    // No outbound message recorded
    const convMsgs = await getMessagesByConversationId(conv.id);
    const outbound = convMsgs.filter((m) => m.direction === 'outbound');
    expect(outbound).toHaveLength(0);
  });

  // Scenario 6: Positive Happy Path: Draft approved -> POST /send -> 7 safety checks pass -> Playwright types & verifies in DOM -> outbound row inserted into messages table -> drafts.status = 'sent' -> audit_logs has MESSAGE_SENT -> Discord alert sent
  it('Scenario 6: executes complete positive send flow passing all 7 safety checks and recording all outcomes', async () => {
    const timestamp = Date.now();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `client_sc6_${timestamp}`,
    });
    createdClientIds.push(client.id);

    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `sc6_conv_${timestamp}`,
      externalUrl: `https://vgen.co/inbox/sc6_${timestamp}`,
    });
    createdConversationIds.push(conv.id);

    const draftContent =
      'Your commercial commission slot is confirmed! Estimated completion is in 2 weeks.';
    const draft = await insertDraft({
      conversationId: conv.id,
      content: draftContent,
      status: DraftStatus.PENDING_APPROVAL,
    });
    createdDraftIds.push(draft.id);

    await draftService.approveDraft({ draftId: draft.id, userId: ownerId });

    // 1. Post to API endpoint
    const sendRes = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(sendRes.status).toBe(202);
    const sendBody = await sendRes.json();
    expect(sendBody.taskId).toBeDefined();
    expect(sendBody.status).toBe('queued');
    const taskId = Number(sendBody.taskId);
    createdTaskIds.push(taskId);

    // 2. Verify Redis Stream received the task publication
    const streamEntries = await redis.xrevrange(STREAMS.SEND, '+', '-', 'COUNT', 5);
    expect(streamEntries.length).toBeGreaterThan(0);
    const foundStreamTask = streamEntries.some((entry) => {
      const fields = entry[1];
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === 'taskId' && fields[i + 1] === String(taskId)) {
          return true;
        }
      }
      return false;
    });
    expect(foundStreamTask).toBe(true);

    // 3. Playwright browser setup
    let typedIntoDOM = '';
    let sendButtonClicked = false;
    const expectedMessageId = `msg-vgen-out-${timestamp}`;

    const mockPage = createMockPage({
      creatorUsername: 'r1daz_',
      simulateSendTimeout: false,
      messageId: expectedMessageId,
      onFill: (val) => {
        typedIntoDOM = val;
      },
      onClickSend: () => {
        sendButtonClicked = true;
      },
    });

    const adapter = new VGenBrowserAdapter({
      createPage: async () => mockPage as any,
      closePage: async () => {},
    });

    // 4. Worker executes task
    const output = await handleSendVgenMessage(
      {
        id: `stream-msg-${taskId}`,
        data: { taskId: String(taskId), draftId: String(draft.id), userId: String(ownerId) },
      },
      {
        adapter,
        messenger: mockMessenger,
        channelId: 'test-channel',
      },
    );

    // 5. Verification of Playwright DOM interaction
    expect(typedIntoDOM).toBe(draftContent);
    expect(sendButtonClicked).toBe(true);
    expect(output.success).toBe(true);
    expect(output.messageId).toBe(expectedMessageId);

    // 6. Verification of Task in DB
    const taskInDb = await getTaskById(taskId);
    expect(taskInDb!.status).toBe(TaskStatus.COMPLETED);
    expect(taskInDb!.output).toMatchObject({
      success: true,
      messageId: expectedMessageId,
    });

    // 7. Verification of Draft in DB
    const draftInDb = await getDraftById(draft.id);
    expect(draftInDb!.status).toBe(DraftStatus.SENT);
    expect(draftInDb!.sentAt).not.toBeNull();

    // 8. Verification of Outbound row in messages table
    const convMsgs = await getMessagesByConversationId(conv.id);
    const outbound = convMsgs.filter((m) => m.direction === 'outbound');
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.content).toBe(draftContent);
    expect(outbound[0]!.senderType).toBe('creator');
    expect(outbound[0]!.senderName).toBe('r1daz_');
    expect(outbound[0]!.externalId).toBe(expectedMessageId);

    // 9. Verification of Audit Logs in DB
    const audits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'draft'),
          eq(auditLogs.targetId, draft.id),
        ),
      );
    const attemptAudit = audits.find((a) => a.action === AuditAction.AGENT_ATTEMPTED_SEND);
    const sentAudit = audits.find((a) => a.action === AuditAction.MESSAGE_SENT);

    expect(attemptAudit).toBeDefined();
    expect(attemptAudit!.actorType).toBe('agent');

    expect(sentAudit).toBeDefined();
    expect(sentAudit!.actorType).toBe('agent');
    expect(sentAudit!.metadata).toMatchObject({
      conversationId: conv.id,
      clientId: client.id,
      messageId: expectedMessageId,
    });

    // 10. Verification of Discord notification
    expect(
      sentDiscordMessages.some((msg) =>
        msg.includes(`🚀 Message successfully delivered to @${client.username} on VGen!`),
      ),
    ).toBe(true);
  });
});
