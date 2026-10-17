import * as cheerio from 'cheerio';
import type { MessageResult } from '@client-agent/platform';
import { sha256Hex } from '@client-agent/shared';
import {
  MESSAGE_BODY_SELECTOR,
  MESSAGE_SENDER_SELECTOR,
  MESSAGE_TIME_SELECTOR,
  OUTBOUND_MARKER,
  THREAD_MESSAGE_SELECTOR,
  THREAD_URL_PATTERN,
} from './selectors';

export interface ParsedThreadMessage {
  senderName: string;
  content: string;
  sentAtRaw: string | null;
  isOutbound: boolean;
}

export function extractMessages(blockHtml: string | string[]): ParsedThreadMessage[] {
  const html = Array.isArray(blockHtml) ? blockHtml.join('\n') : blockHtml;
  const $ = cheerio.load(html);

  return $(THREAD_MESSAGE_SELECTOR)
    .toArray()
    .flatMap((element) => {
      const block = $(element);
      const testBody = block.find(MESSAGE_BODY_SELECTOR);
      const content = (
        testBody.length
          ? testBody.text()
          : (block.find('.str-chat__message-text-inner').first().length
              ? block.find('.str-chat__message-text-inner').first()
              : block.find('.str-chat__message-text').first()
            ).text()
      ).trim();

      if (!content) return [];

      const testSender = block.find(MESSAGE_SENDER_SELECTOR);
      const senderName = (
        testSender.length
          ? testSender.text()
          : block.find('.str-chat__avatar[title]').attr('title') ||
            block.find('.str-chat__message-simple-name').text() ||
            ''
      ).trim();

      const testTime = block.find(MESSAGE_TIME_SELECTOR);
      const sentAtRaw = testTime.length ? testTime.text().trim() : null;

      const isOutbound =
        block.attr(OUTBOUND_MARKER) !== undefined ||
        block.hasClass('str-chat__message--me') ||
        block.find('[data-message-side="outgoing"]').length > 0;

      return [
        {
          senderName,
          content,
          sentAtRaw,
          isOutbound,
        },
      ];
    });
}

export function toMessageResult(m: ParsedThreadMessage, threadId: string): MessageResult {
  return {
    externalId: sha256Hex(`${threadId}|${m.senderName}|${m.content}|${m.sentAtRaw ?? ''}`),
    direction: m.isOutbound ? 'outbound' : 'inbound',
    senderName: m.senderName,
    content: m.content,
    sentAt: parseVGenTimestamp(m.sentAtRaw),
    sentAtRaw: m.sentAtRaw,
  };
}

export function parseExternalThreadId(url: string): string | null {
  return THREAD_URL_PATTERN.exec(url)?.groups?.threadId ?? null;
}

export function parseVGenTimestamp(raw: string | null): Date | null {
  if (raw === null) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const value = new Date(trimmed);
  return Number.isNaN(value.getTime()) ? null : value;
}
