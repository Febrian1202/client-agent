import { describe, expect, it } from 'bun:test';
import {
  NotSupportedError,
  SessionExpiredError,
  extractMessages,
  parseExternalThreadId,
  parseVGenTimestamp,
  toMessageResult,
} from '@client-agent/vgen';
import type { MessageResult } from '@client-agent/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturePath = join(import.meta.dir, 'fixtures', 'thread.html');
const fixtureHtml = readFileSync(fixturePath, 'utf8');

describe('extractMessages', () => {
  it('parses the thread fixture into 3 messages in DOM order', () => {
    const messages = extractMessages(fixtureHtml);

    expect(messages).toBeArrayOfSize(3);
    expect(messages.map((m) => m.senderName)).toEqual(['Rida', 'ErianOsamu', 'Rida']);
    expect(messages.map((m) => m.content)).toEqual([
      'Hi, I can start next week.',
      'Please use the payment plan B.',
      'Sure, updating the invoice now.',
    ]);
    expect(messages.map((m) => m.isOutbound)).toEqual([true, false, true]);
  });

  it('trims sender, body, and time text', () => {
    const html = [
      '<div data-testid="thread-message" data-outbound="true">',
      '  <span data-testid="message-sender">  Rida </span>',
      '  <p data-testid="message-body">  Hello there  </p>',
      '  <time>  2026-10-17T08:30:00Z </time>',
      '</div>',
    ].join('\n');

    const [message] = extractMessages(html);

    expect(message?.senderName).toBe('Rida');
    expect(message?.content).toBe('Hello there');
    expect(message?.sentAtRaw).toBe('2026-10-17T08:30:00Z');
  });

  it('returns null sentAtRaw when the block has no <time>', () => {
    const html =
      '<div data-testid="thread-message"><span data-testid="message-sender">Rida</span><p data-testid="message-body">Sure, updating the invoice now.</p></div>';

    const [message] = extractMessages(html);

    expect(message?.sentAtRaw).toBeNull();
  });

  it('skips blocks with an empty body', () => {
    const emptyBlock =
      '<div data-testid="thread-message"><span data-testid="message-sender">ErianOsamu</span><p data-testid="message-body"></p><time>1h ago</time></div>';
    const whitespaceOnlyBlock =
      '<div data-testid="thread-message"><span data-testid="message-sender">ErianOsamu</span><p data-testid="message-body">   </p></div>';
    const validBlock =
      '<div data-testid="thread-message"><span data-testid="message-sender">Rida</span><p data-testid="message-body">Hi.</p></div>';

    expect(extractMessages([emptyBlock, validBlock, whitespaceOnlyBlock])).toBeArrayOfSize(1);
    expect(extractMessages([emptyBlock, validBlock, whitespaceOnlyBlock])).toEqual([
      { senderName: 'Rida', content: 'Hi.', sentAtRaw: null, isOutbound: false },
    ]);
    expect(extractMessages(emptyBlock)).toBeArrayOfSize(0);
  });

  it('accepts per-block outerHTML arrays and concatenates them before load', () => {
    const blocks = [
      '<div data-testid="thread-message"><span data-testid="message-sender">Rida</span><p data-testid="message-body">A</p></div>',
      '<div data-testid="thread-message"><span data-testid="message-sender">ErianOsamu</span><p data-testid="message-body">B</p><time>2h ago</time></div>',
    ];

    const messages = extractMessages(blocks);

    expect(messages).toBeArrayOfSize(2);
    expect(messages.map((m) => m.senderName)).toEqual(['Rida', 'ErianOsamu']);
  });
});

describe('toMessageResult', () => {
  const base = {
    senderName: 'ErianOsamu',
    content: 'Please use the payment plan B.',
    sentAtRaw: '2026-10-17T08:30:00Z',
    isOutbound: false,
  };

  it('fills direction, senderName, content, sentAt, and raw passthrough', () => {
    const result = toMessageResult(base, 'abc123');

    expect(result.externalId).toBeString();
    expect(result.direction).toBe('inbound');
    expect(result.senderName).toBe('ErianOsamu');
    expect(result.content).toBe('Please use the payment plan B.');
    expect(result.sentAtRaw).toBe('2026-10-17T08:30:00Z');
    expect(result.sentAt).toEqual(new Date('2026-10-17T08:30:00Z'));
    expect(Array.isArray((result as MessageResult).sentAt)).toBeFalse();
  });

  it('is deterministic: same input twice yields the same externalId', () => {
    const first = toMessageResult(base, 'abc123');
    const second = toMessageResult({ ...base }, 'abc123');

    expect(second.externalId).toBe(first.externalId);
  });

  it('changes the externalId when content differs by one character', () => {
    const first = toMessageResult(base, 'abc123');
    const changed = toMessageResult({ ...base, content: 'Please use the payment plan X.' }, 'abc123');

    expect(changed.externalId).not.toBe(first.externalId);
  });

  it('changes the externalId with threadId or sentAtRaw, both nullable forms', () => {
    const first = toMessageResult(base, 'abc123');

    expect(toMessageResult(base, 'def456').externalId).not.toBe(first.externalId);
    expect(toMessageResult({ ...base, sentAtRaw: null }, 'abc123').externalId).not.toBe(
      first.externalId,
    );
  });

  it('maps isOutbound to the outbound direction and null timestamp to sentAt null', () => {
    const result = toMessageResult({ ...base, isOutbound: true, sentAtRaw: null }, 'abc123');

    expect(result.direction).toBe('outbound');
    expect(result.sentAt).toBeNull();
    expect(result.sentAtRaw).toBeNull();
  });
});

describe('parseVGenTimestamp', () => {
  it('parses an absolute ISO timestamp into a Date', () => {
    expect(parseVGenTimestamp('2026-10-17T08:30:00Z')).toEqual(new Date('2026-10-17T08:30:00Z'));
  });

  it('returns null for relative display strings', () => {
    expect(parseVGenTimestamp('2h ago')).toBeNull();
  });

  it('returns null for null, empty, or unparseable input', () => {
    expect(parseVGenTimestamp(null)).toBeNull();
    expect(parseVGenTimestamp('')).toBeNull();
    expect(parseVGenTimestamp('   ')).toBeNull();
    expect(parseVGenTimestamp('not a date')).toBeNull();
  });
});

describe('parseExternalThreadId', () => {
  it('extracts the thread id from an absolute VGen inbox URL', () => {
    expect(parseExternalThreadId('https://vgen.co/inbox/abc123')).toBe('abc123');
  });

  it('extracts the thread id from a relative inbox path', () => {
    expect(parseExternalThreadId('/inbox/abc123')).toBe('abc123');
  });

  it('extracts the thread id from a messages URL, case-insensitively', () => {
    expect(parseExternalThreadId('https://VGEN.CO/Messages/Thread_9')).toBe('Thread_9');
  });

  it('returns null when no thread id is present', () => {
    expect(parseExternalThreadId('https://vgen.co/inbox')).toBeNull();
    expect(parseExternalThreadId('/inbox')).toBeNull();
  });
});

describe('VGen error types', () => {
  it('carries the pinned session-expired message', () => {
    const error = new SessionExpiredError('VGen session has expired — manual re-login required');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('VGen session has expired — manual re-login required');
  });

  it('is a constructible Error subtype for not-supported methods', () => {
    const error = new NotSupportedError('sendMessage');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('not implemented until a later phase: sendMessage');
  });
});
