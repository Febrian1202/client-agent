import * as cheerio from 'cheerio';
import type { MessageAttachment, MessageResult } from '@client-agent/platform';
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
  attachments?: MessageAttachment[];
}

export function extractMessages(blockHtml: string | string[]): ParsedThreadMessage[] {
  const html = Array.isArray(blockHtml) ? blockHtml.join('\n') : blockHtml;
  const $ = cheerio.load(html);

  return $(THREAD_MESSAGE_SELECTOR)
    .toArray()
    .flatMap((element) => {
      const block = $(element);
      const testBody = block.find(MESSAGE_BODY_SELECTOR);
      const textContent = (
        testBody.length
          ? testBody.text()
          : (block.find('.str-chat__message-text-inner').first().length
              ? block.find('.str-chat__message-text-inner').first()
              : block.find('.str-chat__message-text').first()
            ).text()
      ).trim();

      const attachments: MessageAttachment[] = [];
      const attachmentLabels: string[] = [];
      const seenImageUrls = new Set<string>();
      const seenFileUrls = new Set<string>();

      // Extract image attachments (excluding sender/user avatars)
      block.find('img').each((_, imgEl) => {
        const img = $(imgEl);
        if (
          img.closest('.str-chat__avatar, [data-testid*="avatar"], [class*="avatar"]').length > 0 ||
          img.is('[alt="Avatar"], [alt="Account"], [alt="user avatar" i]')
        ) {
          return;
        }

        const src = img.attr('src') || img.attr('data-src') || '';
        const alt = img.attr('alt') || img.attr('title') || '';
        if (src && !seenImageUrls.has(src)) {
          seenImageUrls.add(src);
          attachments.push({
            type: 'image',
            url: src,
            name: alt || undefined,
          });
          const label = alt && alt !== 'image' && !alt.startsWith('http') ? alt : src;
          attachmentLabels.push(`[Attached image: ${label}]`);
        }
      });

      // Extract file attachments
      block
        .find(
          'a[download], .str-chat__message-attachment-file a, .str-chat__message-attachment--file a, a.str-chat__message-attachment-file--item, [data-testid="file-attachment"] a, .str-chat__message-attachment-file, [data-testid="file-attachment"]',
        )
        .each((_, fileEl) => {
          const fileNode = $(fileEl);
          const link = fileNode.is('a') ? fileNode : fileNode.find('a');
          const href = link.attr('href') || fileNode.attr('href') || '';
          const name = link.length
            ? link.text().trim() || link.attr('download') || href
            : fileNode.text().trim() || href;
          const dedupeKey = href || name;
          if (dedupeKey && !seenFileUrls.has(dedupeKey)) {
            seenFileUrls.add(dedupeKey);
            attachments.push({
              type: 'file',
              url: href,
              name: name || undefined,
            });
            attachmentLabels.push(`[Attached file: ${name || href}]`);
          }
        });

      let content = textContent;
      if (attachmentLabels.length > 0) {
        content = textContent ? `${textContent}\n${attachmentLabels.join('\n')}` : attachmentLabels.join('\n');
      }

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
          attachments: attachments.length > 0 ? attachments : undefined,
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
    attachments: m.attachments && m.attachments.length > 0 ? m.attachments : undefined,
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
