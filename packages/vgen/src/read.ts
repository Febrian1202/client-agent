import { type Page, errors as playwrightErrors } from 'playwright';
import {
  VGEN_INBOX_URL,
  VGEN_LOGIN_PATH_HINT,
  INBOX_THREAD_ITEM_SELECTOR,
  THREAD_URL_PATTERN,
  THREAD_MESSAGE_SELECTOR,
} from './selectors';
import {
  SessionExpiredError,
  ClientNotFoundError,
  NavigationTimeoutError,
} from './errors';
import { parseExternalThreadId } from './parse';

export async function openThread(
  page: Page,
  username: string,
): Promise<{ threadId: string; url: string }> {
  if (!page.url().includes('vgen.co')) {
    await page.goto(VGEN_INBOX_URL, { waitUntil: 'domcontentloaded' });
  }

  // Ensure network is idle so Next.js React hydration completes
  await page.waitForLoadState('networkidle').catch(() => {});

  if (page.url().includes(VGEN_LOGIN_PATH_HINT)) {
    throw new SessionExpiredError();
  }

  // Open chat drawer on real VGen if button exists and drawer is not open
  const chatBtn = page.locator('button:has(svg.chatIcon), svg.chatIcon').first();
  if (await chatBtn.isVisible().catch(() => false)) {
    const isListVisible = await page.locator('.str-chat__channel-list').isVisible().catch(() => false);
    if (!isListVisible) {
      // If a channel is open instead of the channel list, close it first to get back to channel list
      const closeBtn = page.locator('.closeBtn').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
      await chatBtn.click();
      await page.locator('.str-chat__channel-list').waitFor({ timeout: 10_000 }).catch(() => {});
    }
  }

  // Wait for channel list items or synthetic conversation items to render
  await page
    .locator(INBOX_THREAD_ITEM_SELECTOR)
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});

  const cleanUser = username.replace(/^@/, '');
  const item = page
    .locator(INBOX_THREAD_ITEM_SELECTOR)
    .filter({ hasText: cleanUser })
    .first();

  try {
    await item.waitFor({ timeout: 5_000 });
  } catch {
    throw new ClientNotFoundError(username);
  }

  await item.click();

  try {
    await Promise.race([
      page.waitForURL(THREAD_URL_PATTERN, { timeout: 15_000 }),
      page.locator('#str-chat__channel .str-chat__message, [data-testid="thread-message"]').first().waitFor({ timeout: 15_000 }),
    ]);
  } catch (e) {
    if (e instanceof playwrightErrors.TimeoutError) {
      throw new NavigationTimeoutError('Waiting for conversation thread URL or container');
    }
    throw e;
  }

  let threadId = parseExternalThreadId(page.url());
  if (!threadId) {
    threadId = await page
      .evaluate(() => {
        const el = document.querySelector('#str-chat__channel');
        const reactKey = Object.keys(el || {}).find(
          (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
        );
        const fiber = reactKey ? (el as any)[reactKey] : null;
        let curr = fiber;
        for (let i = 0; i < 30 && curr; i++) {
          if (curr.memoizedProps?.channel?.id) return curr.memoizedProps.channel.id;
          curr = curr.return;
        }
        return null;
      })
      .catch(() => null);
  }

  if (!threadId) {
    threadId = cleanUser;
  }

  return { threadId, url: page.url() };
}

export async function scrapeThreadMessages(page: Page, limit: number): Promise<string[]> {
  try {
    await page.locator(THREAD_MESSAGE_SELECTOR).first().waitFor({ timeout: 15_000 });
  } catch (e) {
    if (e instanceof playwrightErrors.TimeoutError) {
      throw new NavigationTimeoutError('Waiting for thread message blocks');
    }
    throw e;
  }

  const blocks = await page.locator(THREAD_MESSAGE_SELECTOR).all();

  if (blocks.length === 0) return [];

  const slice = blocks.slice(-limit);
  return Promise.all(slice.map((b) => b.evaluate((el) => el.outerHTML)));
}
