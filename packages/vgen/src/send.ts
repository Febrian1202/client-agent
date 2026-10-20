import { type Page } from 'playwright';
import {
  MESSAGE_INPUT_SELECTOR,
  MESSAGE_SENDER_SELECTOR,
  OUTBOUND_MARKER,
  SEND_BUTTON_SELECTOR,
  THREAD_MESSAGE_SELECTOR,
} from './selectors';
import { SendAmbiguousError } from './errors';

export interface SendMessagePageOptions {
  conversationUrl?: string;
  content: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId: string;
}

export async function sendMessageOnPage(
  page: Page,
  options: SendMessagePageOptions,
): Promise<SendMessageResult> {
  const trimmedContent = options.content?.trim() || '';
  if (!trimmedContent) {
    throw new Error('Cannot send empty message');
  }

  try {
    if (options.conversationUrl && page.url() !== options.conversationUrl) {
      await page.goto(options.conversationUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState?.('networkidle').catch(() => {});
    }

    const input = page.locator(MESSAGE_INPUT_SELECTOR).first();
    await input.waitFor({ timeout: 10_000 });
    await input.focus?.().catch(() => {});

    if (typeof input.pressSequentially === 'function') {
      await input.pressSequentially(options.content, { delay: 15 });
    } else {
      await input.fill(options.content);
    }

    const sendBtn = page.locator(SEND_BUTTON_SELECTOR).first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
    } else {
      await input.press?.('Enter');
    }

    // Post-Send Verification:
    // Poll up to 10s for newest message bubble matching trimmedContent
    const startTime = Date.now();
    let verified = false;
    let extractedId: string | null = null;

    while (Date.now() - startTime < 10_000) {
      const newestBubble = page.locator(THREAD_MESSAGE_SELECTOR).last();
      await newestBubble.waitFor({ timeout: 2_000 }).catch(() => {});
      const bubbleText = (await newestBubble.innerText().catch(() => '')) || '';
      if (bubbleText.includes(trimmedContent)) {
        verified = true;
        extractedId =
          (await newestBubble.getAttribute('data-message-id').catch(() => null)) ||
          (await newestBubble.getAttribute('id').catch(() => null));
        break;
      }
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(100);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    if (!verified) {
      throw new Error('Newest message bubble does not match sent content');
    }

    return {
      success: true,
      messageId: extractedId || `vgen_out_${Date.now()}`,
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'Cannot send empty message') {
      throw err;
    }

    // Ambiguous Recovery Block:
    await page.reload?.({ waitUntil: 'domcontentloaded' }).catch(() => {});
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(500).catch(() => {});
    }

    const recentBubbles = await page.locator(THREAD_MESSAGE_SELECTOR).all().catch(() => []);
    const lastFive = recentBubbles.slice(-5);

    for (const bubble of lastFive) {
      const text = (await bubble.innerText?.().catch(() => '')) || '';
      let matches = text.includes(trimmedContent);

      if (!matches) {
        const evalText =
          (await bubble
            .evaluate?.((el: HTMLElement) => el.innerText || el.textContent || '')
            .catch(() => '')) || '';
        matches = evalText.includes(trimmedContent);
      }

      if (!matches) {
        continue;
      }

      // Direction check: verify bubble is outbound / from creator if markers are present.
      const outboundAttr = await bubble.getAttribute?.(OUTBOUND_MARKER).catch(() => null);
      const senderText = (
        await bubble.locator?.(MESSAGE_SENDER_SELECTOR).first().innerText?.().catch(() => '')
      )?.trim().toLowerCase() || '';
      const classAttr = (await bubble.getAttribute?.('class').catch(() => '')) || '';

      const isOutboundByAttr = outboundAttr !== null && outboundAttr !== 'false';
      const isOutboundBySender =
        senderText.length > 0 && /\b(you|creator|me)\b/i.test(senderText);
      const isOutboundByClass = classAttr.includes('str-chat__message--me');

      const hasExplicitOutbound = isOutboundByAttr || isOutboundBySender || isOutboundByClass;
      const hasConflictingIndicator =
        (outboundAttr !== null && outboundAttr === 'false') ||
        (senderText.length > 0 && !isOutboundBySender) ||
        classAttr.includes('str-chat__message--other');

      if (hasConflictingIndicator && !hasExplicitOutbound) {
        continue;
      }

      return {
        success: true,
        messageId: `vgen_recovered_${Date.now()}`,
      };
    }

    throw new SendAmbiguousError(err instanceof Error ? err.message : String(err));
  }
}
