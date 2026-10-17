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
  await page.goto(VGEN_INBOX_URL, { waitUntil: 'domcontentloaded' });

  if (page.url().includes(VGEN_LOGIN_PATH_HINT)) {
    throw new SessionExpiredError();
  }

  const item = page.locator(INBOX_THREAD_ITEM_SELECTOR).filter({ hasText: username }).first();

  if ((await item.count()) === 0) {
    throw new ClientNotFoundError(username);
  }

  await item.click();

  try {
    await page.waitForURL(THREAD_URL_PATTERN, { timeout: 30_000 });
  } catch (e) {
    if (e instanceof playwrightErrors.TimeoutError) {
      throw new NavigationTimeoutError('Waiting for conversation thread URL');
    }
    throw e;
  }

  const threadId = parseExternalThreadId(page.url());
  if (!threadId) {
    throw new NavigationTimeoutError('Thread URL missing id');
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
