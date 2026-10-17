import { describe, expect, it } from 'bun:test';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { MessageResult } from '@client-agent/platform';
import {
  formatConversationPreview,
  handleReadInteraction,
  READ_COMMAND,
  type ReadInteractionDeps,
} from '../src/commands/read';

function message(overrides: Partial<MessageResult> = {}): MessageResult {
  return {
    externalId: 'm-1', direction: 'inbound', senderName: 'ErianOsamu',
    content: 'Hello! Is this commission slot still open?', sentAt: new Date('2026-10-16T14:30:00.000Z'),
    ...overrides,
  };
}

describe('Conversation preview formatting', () => {
  it('uses the exact header shape with the message count', () => {
    const text = formatConversationPreview('ErianOsamu', [message()]);
    expect(text).toContain('📨 Conversation with @ErianOsamu (latest 1)');
  });

  it('renders messages chronologically with sender and UTC time', () => {
    const older = message({ externalId: 'm-1', senderName: 'Creator', direction: 'outbound', sentAt: new Date('2026-10-15T09:00:00.000Z'), content: 'Yes, one slot is open.' });
    const newer = message({ externalId: 'm-2', content: 'Great, I will send the form tonight.' });
    const text = formatConversationPreview('ErianOsamu', [older, newer]);
    expect(text.indexOf('Creator')).toBeLessThan(text.indexOf('Great, I will send the form tonight.'));
    expect(text).toContain('2026-10-15 09:00 UTC');
  });

  it('collapses newlines and truncates long message bodies', () => {
    const noisy = message({ content: 'line one\n\nline two\nline three' });
    expect(formatConversationPreview('ErianOsamu', [noisy])).toContain('> line one line two line three');

    const long = message({ content: 'x'.repeat(500) });
    const text = formatConversationPreview('ErianOsamu', [long]);
    expect(text).not.toContain('x'.repeat(300));
    expect(text).toContain('x'.repeat(200));
  });

  it('shows "time unknown" when sentAt is null', () => {
    const text = formatConversationPreview('ErianOsamu', [message({ sentAt: null })]);
    expect(text).toContain('time unknown');
  });

  it('drops the oldest entries and recounts the header when the preview is too long', () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      message({ externalId: `m-${i}`, senderName: `Sender ${i}`, content: `${i}: ${'x'.repeat(320)}` }),
    );
    const text = formatConversationPreview('ErianOsamu', messages);
    expect(text).toContain('(latest 5)');
    expect(text).toContain('Sender 5');
    expect(text).not.toContain('Sender 0');
    expect(text.length).toBeLessThanOrEqual(1900);
  });

  it('never exceeds the Discord hard limit with 2,500-char bodies', () => {
    const messages = Array.from({ length: 4 }, (_, i) =>
      message({ externalId: `m-${i}`, content: 'y'.repeat(2500) }),
    );
    const text = formatConversationPreview('ErianOsamu', messages);
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});

describe('READ_COMMAND registration payload', () => {
  it('declares the /read command with a required username string option', () => {
    expect(READ_COMMAND.name).toBe('read');
    expect(READ_COMMAND.options[0]).toMatchObject({ name: 'username', required: true });
  });
});

function fakeInteraction(input: {
  username?: string;
  failEnqueue?: boolean;
}) {
  const calls = {
    reply: [] as unknown[],
    editReply: [] as unknown[],
    followUp: [] as unknown[],
    enqueued: [] as unknown[],
  };
  const interaction = {
    options: { getString: () => input.username ?? 'ErianOsamu' },
    reply: async (content: unknown) => { calls.reply.push(content); },
    editReply: async (content: unknown) => { calls.editReply.push(content); },
    followUp: async (content: unknown) => { calls.followUp.push(content); },
    id: 'int-1',
    token: 'tok-1',
    applicationId: 'app-1',
    channelId: 'chan-1',
    commandName: 'read',
  } as unknown as ChatInputCommandInteraction;

  const deps: ReadInteractionDeps = {
    enqueue: async (pending) => {
      if (input.failEnqueue) throw new Error('queue down');
      calls.enqueued.push(pending);
    },
  };
  return { interaction, deps, calls };
}

describe('handleReadInteraction', () => {
  it('replies with the pending text and enqueues the read task', async () => {
    const { interaction, deps, calls } = fakeInteraction({});
    await handleReadInteraction(interaction, deps);
    expect(calls.reply[0]).toBe('Fetching conversation for @ErianOsamu... ⏳');
    expect(calls.enqueued[0]).toEqual({
      clientUsername: 'ErianOsamu',
      interactionId: 'int-1',
      interactionToken: 'tok-1',
      applicationId: 'app-1',
      channelId: 'chan-1',
    });
  });

  it('asks for a username instead of enqueueing a blank one', async () => {
    const { interaction, deps, calls } = fakeInteraction({ username: '   ' });
    await handleReadInteraction(interaction, deps);
    expect(calls.editReply[0]).toBe('Please provide a VGen username, e.g. /read ErianOsamu.');
    expect(calls.enqueued).toHaveLength(0);
  });

  it('follows up with the failure text and never throws when enqueue fails', async () => {
    const { interaction, deps, calls } = fakeInteraction({ failEnqueue: true });
    await handleReadInteraction(interaction, deps);
    expect(calls.reply[0]).toBe('Fetching conversation for @ErianOsamu... ⏳');
    expect(calls.followUp[0]).toBe('Failed to queue the read request. Check the worker logs.');
  });
});
