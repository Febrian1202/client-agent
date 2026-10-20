import { type Page, errors as playwrightErrors } from 'playwright';
import { getSharedBrowserContext, checkVGenAuthStatus } from '@client-agent/browser';
import { normalizeCreatorUsername } from '@client-agent/domain';
import type {
  PlatformAdapter,
  ConversationResult,
  MessageResult,
  FindClientInput,
  ClientResult,
  GetConversationInput,
} from '@client-agent/platform';
import { SessionExpiredError, NavigationTimeoutError, NotSupportedError } from './errors';
import { openThread, scrapeThreadMessages } from './read';
import { extractMessages, toMessageResult } from './parse';
import {
  CREATOR_PROFILE_MARKER,
  NON_PROFILE_PATHS,
  THREAD_URL_PATTERN,
  VGEN_DASHBOARD_URL,
} from './selectors';
import { sendMessageOnPage } from './send';

export interface VGenAdapterOptions {
  createPage?: () => Promise<Page>;
  closePage?: (page: Page) => Promise<void>;
  openThread?: (page: Page, username: string) => Promise<{ threadId: string; url: string }>;
}

export class VGenBrowserAdapter implements PlatformAdapter {
  private readonly createPage: () => Promise<Page>;
  private readonly closePage: (page: Page) => Promise<void>;
  private readonly openThreadFn: (page: Page, username: string) => Promise<{ threadId: string; url: string }>;

  constructor(options?: VGenAdapterOptions) {
    this.createPage =
      options?.createPage ?? (async () => (await getSharedBrowserContext()).newPage());
    this.closePage = options?.closePage ?? (async (page) => page.close());
    this.openThreadFn = options?.openThread ?? openThread;
  }

  async getConversation({ clientUsername, limit = 20 }: GetConversationInput): Promise<ConversationResult> {
    const page = await this.createPage();
    try {
      const authed = await checkVGenAuthStatus(page);
      if (!authed) throw new SessionExpiredError();

      const { threadId, url } = await this.openThreadFn(page, clientUsername);
      const blocks = await scrapeThreadMessages(page, limit);

      const messages: MessageResult[] = blocks
        .flatMap((b) => {
          const parsed = extractMessages(b)[0];
          if (!parsed) return [];
          return [toMessageResult(parsed, threadId)];
        })
        .filter((m) => m.content.length > 0);

      return { externalId: threadId, externalUrl: url, clientUsername, messages };
    } catch (e) {
      if (e instanceof playwrightErrors.TimeoutError) {
        throw new NavigationTimeoutError(String(e));
      }
      throw e;
    } finally {
      await this.closePage(page);
    }
  }

  async findClient(_input: FindClientInput): Promise<ClientResult> {
    throw new NotSupportedError('findClient');
  }

  async getMessages(_input: { conversationId: string; limit?: number }): Promise<MessageResult[]> {
    throw new NotSupportedError('getMessages');
  }

  async sendMessage(input: {
    conversationId: string;
    content: string;
    conversationUrl?: string;
    clientUsername?: string;
  }): Promise<{ success: boolean; messageId: string }> {
    const page = await this.createPage();
    try {
      const authed = await checkVGenAuthStatus(page);
      if (!authed) throw new SessionExpiredError();

      let targetUrl = input.conversationUrl;
      const isDirectThreadUrl = targetUrl ? THREAD_URL_PATTERN.test(targetUrl) : false;

      if ((!targetUrl || !isDirectThreadUrl) && input.clientUsername) {
        if (targetUrl && page.url() !== targetUrl) {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        }
        const thread = await this.openThreadFn(page, input.clientUsername);
        targetUrl = thread.url;
      }
      if (!targetUrl) {
        throw new Error('Either conversationUrl or clientUsername must be provided to sendMessage');
      }

      if (!isDirectThreadUrl && !input.clientUsername) {
        throw new Error('Cannot send message to non-thread URL without clientUsername to open chat drawer');
      }

      return await sendMessageOnPage(page, {
        conversationUrl: targetUrl,
        content: input.content,
      });
    } finally {
      await this.closePage(page);
    }
  }

  async getAuthenticatedUsername(page?: Page): Promise<string | null> {
    const targetPage = page ?? (await this.createPage());
    const shouldClose = !page;

    try {
      if (!page || targetPage.url() === 'about:blank') {
        await targetPage.goto(VGEN_DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
      }

      // If profile link is still hydrating (e.g. href="https://vgen.co/undefined"), wait for React hydration
      if (typeof targetPage.waitForFunction === 'function') {
        await targetPage
          .waitForFunction(
            (selector) => {
              const links = document.querySelectorAll(selector);
              for (const link of links) {
                const href = link.getAttribute('href') || '';
                if (href.includes('vgen.co') && !href.includes('/undefined') && !href.includes('/null')) {
                  return true;
                }
              }
              return false;
            },
            CREATOR_PROFILE_MARKER,
            { timeout: 7000 },
          )
          .catch(() => {});
      }

      const locator = targetPage.locator(CREATOR_PROFILE_MARKER);
      let elements = typeof locator.all === 'function' ? await locator.all() : [];
      if (elements.length === 0) {
        elements = [locator.first()];
      }
      const nonProfileSlugs = new Set(NON_PROFILE_PATHS.map((p) => p.toLowerCase()));

      for (const el of elements) {
        const visible = await el.isVisible().catch(() => false);
        if (!visible) continue;

        // 1. Check href for candidate profile link
        let href = await el.getAttribute('href').catch(() => null);
        if (!href && typeof el.locator === 'function') {
          href = await el.locator('xpath=ancestor-or-self::a').first().getAttribute('href').catch(() => null);
        }
        if (href) {
          let pathname = href;
          try {
            pathname = new URL(href, 'https://vgen.co').pathname;
          } catch {
            pathname = href.replace(/^https?:\/\/(?:www\.)?vgen\.co/i, '');
          }
          const segments = pathname.replace(/^\/+|\/+$/g, '').split('/');
          const firstSegment = segments[0];
          if (firstSegment && !nonProfileSlugs.has(firstSegment.toLowerCase())) {
            const normalized = normalizeCreatorUsername(firstSegment);
            if (normalized && !nonProfileSlugs.has(normalized) && /^[a-z0-9_-]+$/i.test(normalized)) {
              return normalized;
            }
          }
        }

        // 2. Check data-username attribute
        const dataUser = (await el.getAttribute('data-username').catch(() => ''))?.trim();
        if (dataUser) {
          const normalized = normalizeCreatorUsername(dataUser);
          if (normalized && !nonProfileSlugs.has(normalized) && /^[a-z0-9_-]+$/i.test(normalized)) {
            return normalized;
          }
        }

        // 3. Check alt attribute (e.g. avatar image)
        const alt = (await el.getAttribute('alt').catch(() => ''))?.trim();
        if (alt) {
          const normalized = normalizeCreatorUsername(alt);
          if (normalized && !nonProfileSlugs.has(normalized) && /^[a-z0-9_-]+$/i.test(normalized)) {
            return normalized;
          }
        }

        // 4. Check innerText (only if it looks like a valid username slug)
        const text = (await el.innerText().catch(() => ''))?.trim();
        if (text) {
          const normalized = normalizeCreatorUsername(text);
          if (normalized && !nonProfileSlugs.has(normalized) && /^[a-z0-9_-]+$/i.test(normalized)) {
            return normalized;
          }
        }
      }

      return null;
    } finally {
      if (shouldClose) {
        await this.closePage(targetPage);
      }
    }
  }
}
