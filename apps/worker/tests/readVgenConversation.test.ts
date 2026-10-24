import { describe, expect, it, afterAll } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  agentTasks,
  auditLogs,
  clients,
  conversations,
  messages,
  createTask,
  getOwnerUserId,
  getTaskById,
  upsertClient,
  upsertConversation,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { NonRetriableError, type ParsedTask } from '@client-agent/queue';
import type { ConversationResult, MessageResult, PlatformAdapter } from '@client-agent/platform';
import { ClientNotFoundError, SessionExpiredError } from '@client-agent/vgen';
import {
  handleReadVgenConversation,
  handleSyncConversation,
  runConversationRead,
  type ReadVgenTaskInput,
} from '../src/handlers/readVgenConversation';

const ownerId = await getOwnerUserId();
const runTag = `p3t9-${Date.now()}`;
let seq = 0;

const createdTaskIds: number[] = [];
const createdClientIds: number[] = [];
const createdConversationIds: number[] = [];
const createdMessageIds: number[] = [];

afterAll(async () => {
  if (createdMessageIds.length > 0) {
    await db.delete(messages).where(inArray(messages.id, createdMessageIds));
  }
  if (createdConversationIds.length > 0) {
    await db
      .delete(messages)
      .where(inArray(messages.conversationId, createdConversationIds));
    await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
  }
  if (createdClientIds.length > 0) {
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
  if (createdTaskIds.length > 0) {
    await db.delete(agentTasks).where(inArray(agentTasks.id, createdTaskIds));
  }
});

function message(externalId: string, overrides: Partial<MessageResult> = {}): MessageResult {
  return {
    externalId,
    direction: 'inbound',
    senderName: 'ErianOsamu',
    content: `hello ${externalId}`,
    sentAt: new Date('2026-10-16T10:00:00.000Z'),
    sentAtRaw: '2026-10-16 10:00',
    ...overrides,
  };
}

type GetConversationStub = (
  input: { clientUsername: string },
) => Promise<ConversationResult>;

function makeAdapter(handler: GetConversationStub): Pick<PlatformAdapter, 'getConversation'> {
  return { getConversation: handler };
}

interface MessengerCall {
  method: 'editInteractionFollowup' | 'sendChannelMessage';
  args: unknown[];
}

function makeMessenger(overrides?: Partial<Record<'editInteractionFollowup', (call: MessengerCall, input: { applicationId: string; interactionToken: string; content: string }) => Promise<{ messageId: string | null }>>>): {
  messenger: import('@client-agent/discord').DiscordMessenger;
  calls: MessengerCall[];
} {
  const calls: MessengerCall[] = [];
  return {
    messenger: {
      editInteractionFollowup: async (input) => {
        const call: MessengerCall = { method: 'editInteractionFollowup', args: [input] };
        calls.push(call);
        const fail = overrides?.editInteractionFollowup;
        if (fail) return await fail(call, input);
        return { messageId: 'fm-1' };
      },
      sendChannelMessage: async (channelId, content) => {
        calls.push({ method: 'sendChannelMessage', args: [channelId, content] });
        return { messageId: 'cm-1' };
      },
    },
    calls,
  };
}

async function seedTask(input: Record<string, unknown>, type: TaskType = TaskType.READ_VGEN_CONVERSATION) {
  seq += 1;
  const task = await createTask({
    userId: ownerId,
    type,
    input,
    idempotencyKey: `${runTag}-${seq}`,
  });
  createdTaskIds.push(task.id);
  return task;
}

function parsedTask(taskId: number, type: TaskType = TaskType.READ_VGEN_CONVERSATION): ParsedTask {
  return { id: `${runTag}-${taskId}`, data: { taskId: String(taskId), type } };
}

function trackConversation(output: { conversationId: number; clientId: number }): void {
  createdConversationIds.push(output.conversationId);
  createdClientIds.push(output.clientId);
}

describe('READ_VGEN_CONVERSATION handler', () => {
  it('persists client, conversation, messages, audit row and reports 3 new messages', async () => {
    const username = `Erian_${runTag}_succ`;
    const externalId = `conv_${runTag}_succ`;
    const adapter = makeAdapter(async () => ({
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
      clientUsername: username,
      messages: [message(`${externalId}-m1`), message(`${externalId}-m2`), message(`${externalId}-m3`)],
    }));
    const task = await seedTask({ clientUsername: username, requestedBy: 'api' });

    const output = await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger: null });

    trackConversation(output);
    expect(output.messagesNew).toBe(3);
    expect(output.messagesReceived).toBe(3);
    expect(output.deliveredVia).toBe('none');
    expect(output.conversationExternalId).toBe(externalId);
    expect(output.externalUrl).toBe(`https://vgen.co/thread/${externalId}`);

    const conversationRow = (await db.select().from(conversations).where(eq(conversations.id, output.conversationId)))[0]!;
    expect(conversationRow.externalId).toBe(externalId);
    expect(conversationRow.lastSyncedAt).not.toBeNull();

    const storedMessages = await db.select().from(messages).where(eq(messages.conversationId, output.conversationId));
    expect(storedMessages).toHaveLength(3);
    expect(storedMessages.every((m) => m.senderType === 'client' && m.direction === 'inbound')).toBe(true);
    expect(storedMessages.every((m) => (m.metadata as { sentAtRaw: string | null }).sentAtRaw === '2026-10-16 10:00')).toBe(true);

    const clientRow = (await db.select().from(clients).where(eq(clients.id, output.clientId)))[0]!;
    expect(clientRow.username).toBe(username);
    expect(clientRow.platform).toBe('vgen');

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'AGENT_READ_CONVERSATION'), eq(auditLogs.targetType, 'conversation'), eq(auditLogs.targetId, output.conversationId)));
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as { messagesNew: number }).messagesNew).toBe(3);

    const taskRow = await getTaskById(task.id);
    expect(taskRow!.status).toBe(TaskStatus.COMPLETED);
    expect(taskRow!.output).toEqual(output);
  });

  it('returns the stored output without re-running the adapter once completed', async () => {
    const username = `Erian_${runTag}_idem`;
    const externalId = `conv_${runTag}_idem`;
    let calls = 0;
    const adapter = makeAdapter(async () => {
      calls += 1;
      return {
        externalId,
        externalUrl: `https://vgen.co/thread/${externalId}`,
        clientUsername: username,
        messages: [message(`${externalId}-m1`)],
      };
    });
    const task = await seedTask({ clientUsername: username, requestedBy: 'api' });
    const deps = { adapter, messenger: null };

    const first = await handleReadVgenConversation(parsedTask(task.id), deps);
    trackConversation(first);
    const second = await handleReadVgenConversation(parsedTask(task.id), deps);

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it('inserts only new messages when the adapter returns a mix of known and new rows', async () => {
    const username = `Erian_${runTag}_dedup`;
    const externalId = `conv_${runTag}_dedup`;
    const input: ReadVgenTaskInput = { clientUsername: username };
    const task = await seedTask({ clientUsername: username });

    const first = await runConversationRead(input, task.id, {
      adapter: makeAdapter(async () => ({
        externalId,
        externalUrl: `https://vgen.co/thread/${externalId}`,
        clientUsername: username,
        messages: [message(`${externalId}-s1`), message(`${externalId}-s2`), message(`${externalId}-s3`)],
      })),
      messenger: null,
    });

    const shared = [message(`${externalId}-s1`), message(`${externalId}-s2`)];
    const second = await runConversationRead(input, task.id, {
      adapter: makeAdapter(async () => ({
        externalId,
        externalUrl: `https://vgen.co/thread/${externalId}`,
        clientUsername: username,
        messages: [
          ...shared,
          message(`${externalId}-n1`, { direction: 'outbound', senderName: 'creator' }),
          message(`${externalId}-n2`),
        ],
      })),
      messenger: null,
    });

    trackConversation(first);
    expect(first.conversationId).toBe(second.conversationId);
    expect(first.messagesNew).toBe(3);
    expect(second.messagesNew).toBe(2);

    const stored = await db.select().from(messages).where(eq(messages.conversationId, first.conversationId));
    expect(stored).toHaveLength(5);
    const distinctExternalIds = new Set(stored.map((m) => m.externalId));
    expect(distinctExternalIds.size).toBe(5);
    const outbound = stored.find((m) => m.externalId === `${externalId}-n1`)!;
    expect(outbound.direction).toBe('outbound');
    expect(outbound.senderType).toBe('creator');
  });

  it('persists message attachments in message metadata', async () => {
    const username = `Erian_${runTag}_att`;
    const externalId = `conv_${runTag}_att`;
    const msgWithAttachment = message(`${externalId}-att1`, {
      content: 'Here is the image:\n[Attached image: ref.png]',
      attachments: [
        {
          type: 'image',
          url: 'https://vgen.co/media/ref.png',
          name: 'ref.png',
        },
      ],
    });

    const adapter = makeAdapter(async () => ({
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
      clientUsername: username,
      messages: [msgWithAttachment],
    }));
    const task = await seedTask({ clientUsername: username, requestedBy: 'api' });

    const output = await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger: null });
    trackConversation(output);

    const stored = await db.select().from(messages).where(eq(messages.conversationId, output.conversationId));
    expect(stored).toHaveLength(1);
    const meta = stored[0]!.metadata as any;
    expect(meta.attachments).toEqual([
      {
        type: 'image',
        url: 'https://vgen.co/media/ref.png',
        name: 'ref.png',
      },
    ]);
  });

  it('alerts the channel and audited SESSION_EXPIRED before failing non-retriably', async () => {
    const username = `Erian_${runTag}_exp`;
    const { messenger, calls } = makeMessenger();
    const adapter = makeAdapter(async () => {
      throw new SessionExpiredError();
    });
    const task = await seedTask({
      clientUsername: username,
      requestedBy: 'discord',
      discord: { channelId: 'chan-77' },
    });

    let caught: unknown;
    try {
      await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger });
      expect.unreachable();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain('awaiting manual re-auth');

    const alerts = calls.filter((c) => c.method === 'sendChannelMessage');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.args[0]).toBe('chan-77');
    expect(String(alerts[0]!.args[1])).toBe(
      '⚠️ VGen session has expired! Please log in via browser profile to resume automation.',
    );

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'SESSION_EXPIRED'), eq(auditLogs.targetType, 'task'), eq(auditLogs.targetId, task.id)));
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as { clientUsername: string }).clientUsername).toBe(username);

    const taskRow = await getTaskById(task.id);
    expect(taskRow!.status).toBe(TaskStatus.FAILED);
    expect(taskRow!.error).toContain('awaiting manual re-auth');
  });

  it('maps ClientNotFoundError to a NonRetriableError', async () => {
    const username = `Erian_${runTag}_cnf`;
    const adapter = makeAdapter(async () => {
      throw new ClientNotFoundError(username);
    });
    const task = await seedTask({ clientUsername: username });

    let caught: unknown;
    try {
      await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger: null });
      expect.unreachable();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain(`VGen client not found: ${username}`);
    const taskRow = await getTaskById(task.id);
    expect(taskRow!.status).toBe(TaskStatus.FAILED);
  });

  it('keeps the task completed when interaction delivery fails and uses formatConversationPreview content', async () => {
    const username = `Erian_${runTag}_delfail`;
    const externalId = `conv_${runTag}_delfail`;
    const adapter = makeAdapter(async () => ({
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
      clientUsername: username,
      messages: [message(`${externalId}-m1`, { senderName: 'TheCreator', direction: 'outbound' })],
    }));
    const { messenger, calls } = makeMessenger({
      editInteractionFollowup: async () => {
        throw new Error('404: Unknown Webhook');
      },
    });
    const task = await seedTask({
      clientUsername: username,
      requestedBy: 'discord',
      discord: { interactionToken: 'token-1', applicationId: 'app-1', channelId: 'chan-88' },
    });

    const output = await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger });

    trackConversation(output);
    expect(output.deliveredVia).toBe('interaction');
    expect(output.deliveryError).toContain('404: Unknown Webhook');

    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.COMPLETED);

    expect(calls).toHaveLength(1);
    const content = (calls[0]!.args[0] as { content: string }).content;
    expect(content).toContain(`📨 Conversation with @${username}`);
    expect(content).toContain('**TheCreator · 2026-10-16 10:00 UTC**');
    expect(content).toContain(`> hello ${externalId}-m1`);
  });

  it('previews only the newest five of forty messages', async () => {
    const username = `Erian_${runTag}_bulk`;
    const externalId = `conv_${runTag}_bulk`;
    const bulk = Array.from({ length: 40 }, (_, i) =>
      message(`${externalId}-b${i + 1}`, { content: `bodies ${i + 1}` }),
    );
    const adapter = makeAdapter(async () => ({
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
      clientUsername: username,
      messages: bulk,
    }));
    const { messenger, calls } = makeMessenger();
    const task = await seedTask({
      clientUsername: username,
      requestedBy: 'discord',
      discord: { interactionToken: 'token-2', applicationId: 'app-2' },
    });

    const output = await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger });

    trackConversation(output);
    expect(output.messagesReceived).toBe(40);
    expect(output.messagesNew).toBe(40);
    expect(output.deliveredVia).toBe('interaction');

    const content = (calls[0]!.args[0] as { content: string }).content;
    for (const n of [36, 37, 38, 39, 40]) {
      expect(content).toContain(`bodies ${n}`);
    }
    expect(content).toContain('latest 5');
    expect(content).not.toContain(`bodies 3\n`);
    expect(content).not.toContain(`bodies 35\n`);
  });

  it('delivers via the channel when no interaction token is present', async () => {
    const username = `Erian_${runTag}_chan`;
    const externalId = `conv_${runTag}_chan`;
    const adapter = makeAdapter(async () => ({
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
      clientUsername: username,
      messages: [message(`${externalId}-m1`)],
    }));
    const { messenger, calls } = makeMessenger();
    const task = await seedTask({
      clientUsername: username,
      requestedBy: 'discord',
      discord: { channelId: 'chan-99' },
    });

    const output = await handleReadVgenConversation(parsedTask(task.id), { adapter, messenger });

    trackConversation(output);
    expect(output.deliveredVia).toBe('channel');
    expect(output.deliveryError).toBeUndefined();
    expect(calls[0]!.method).toBe('sendChannelMessage');
    expect(calls[0]!.args[0]).toBe('chan-99');
  });

  it('delegates SYNC_CONVERSATION to the DB-resolved username', async () => {
    const username = `Erian_${runTag}_sync`;
    const externalId = `conv_${runTag}_sync`;
    const seededClient = await upsertClient({ userId: ownerId, platform: 'vgen', username });
    createdClientIds.push(seededClient.id);
    const seededConversation = await upsertConversation({
      clientId: seededClient.id,
      platform: 'vgen',
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
    });
    createdConversationIds.push(seededConversation.id);

    const adapter = makeAdapter(async () => ({
      externalId,
      externalUrl: `https://vgen.co/thread/${externalId}`,
      clientUsername: username,
      messages: [
        message(`${externalId}-in1`),
        message(`${externalId}-out1`, { direction: 'outbound', senderName: 'creator' }),
      ],
    }));
    const task = await seedTask({ conversationId: seededConversation.id }, TaskType.SYNC_CONVERSATION);

    const output = await handleSyncConversation(parsedTask(task.id, TaskType.SYNC_CONVERSATION), {
      adapter,
      messenger: null,
    });

    expect(output.conversationId).toBe(seededConversation.id);
    trackConversation(output);
    expect(output.clientId).toBe(seededClient.id);
    expect(output.messagesNew).toBe(2);
    expect(output.deliveredVia).toBe('none');

    const conversationRow = (await db.select().from(conversations).where(eq(conversations.id, output.conversationId)))[0]!;
    expect(conversationRow.lastSyncedAt).not.toBeNull();
    const taskRow = await getTaskById(task.id);
    expect(taskRow!.status).toBe(TaskStatus.COMPLETED);
  });

  it('fails SYNC_CONVERSATION with a plain retryable Error for an unknown conversation', async () => {
    const task = await seedTask({ conversationId: 987654321 }, TaskType.SYNC_CONVERSATION);

    let caught: unknown;
    try {
      await handleSyncConversation(parsedTask(task.id, TaskType.SYNC_CONVERSATION), {
        adapter: makeAdapter(async () => {
          throw new Error('adapter should not be reached');
        }),
        messenger: null,
      });
      expect.unreachable();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain('SYNC_CONVERSATION input missing conversation');
    const taskRow = await getTaskById(task.id);
    expect(taskRow!.status).toBe(TaskStatus.FAILED);
  });
});
