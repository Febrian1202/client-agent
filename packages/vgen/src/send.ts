import { type Page } from 'playwright';
import {
  MESSAGE_INPUT_SELECTOR,
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
  const trimmedContent = options.content.trim();

  try {
    if (options.conversationUrl && page.url() !== options.conversationUrl) {
      await page.goto(options.conversationUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState?.('networkidle').catch(() => {});
    }

    const input = page.locator(MESSAGE_INPUT_SELECTOR).first();
    await input.waitFor({ timeout: 10_000 });
    await input.fill(options.content);

    const sendBtn = page.locator(SEND_BUTTON_SELECTOR).first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
    } else {
      await input.press?.('Enter');
    }

    // Post-Send Verification:
    // Wait up to 10s for newest message bubble in THREAD_MESSAGE_SELECTOR
    const newestBubble = page.locator(THREAD_MESSAGE_SELECTOR).last();
    await newestBubble.waitFor({ timeout: 10_000 });

    const bubbleText = (await newestBubble.innerText().catch(() => '')) || '';
    if (!bubbleText.includes(trimmedContent)) {
      throw new Error('Newest message bubble does not match sent content');
    }

    const extractedId =
      (await newestBubble.getAttribute('data-message-id').catch(() => null)) ||
      (await newestBubble.getAttribute('id').catch(() => null));

    return {
      success: true,
      messageId: extractedId || `vgen_out_${Date.now()}`,
    };
  } catch (err) {
    // Ambiguous Recovery Block:
    await page.reload?.({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout?.(500).catch(() => {});

    const recentBubbles = await page.locator(THREAD_MESSAGE_SELECTOR).all().catch(() => []);
    const lastFive = recentBubbles.slice(-5);

    for (const bubble of lastFive) {
      const text = (await bubble.innerText?.().catch(() => '')) || '';
      if (text.includes(trimmedContent)) {
        return {
          success: true,
          messageId: `vgen_recovered_${Date.now()}`,
        };
      }

      const evalText =
        (await bubble
          .evaluate?.((el: HTMLElement) => el.innerText || el.textContent || '')
          .catch(() => '')) || '';
      if (evalText.includes(trimmedContent)) {
        return {
          success: true,
          messageId: `vgen_recovered_${Date.now()}`,
        };
      }
    }

    throw new SendAmbiguousError(err instanceof Error ? err.message : String(err));
  }
}
