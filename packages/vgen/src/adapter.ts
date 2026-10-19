import { type Page, errors as playwrightErrors } from 'playwright';
import { getSharedBrowserContext, checkVGenAuthStatus } from '@client-agent/browser';
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
import { CREATOR_PROFILE_MARKER, VGEN_DASHBOARD_URL } from './selectors';
import { sendMessageOnPage } from './send';

export interface VGenAdapterOptions {
  createPage?: () => Promise<Page>;
  closePage?: (page: Page) => Promise<void>;
}

export class VGenBrowserAdapter implements PlatformAdapter {
  private readonly createPage: () => Promise<Page>;
  private readonly closePage: (page: Page) => Promise<void>;

  constructor(options?: VGenAdapterOptions) {
    this.createPage =
      options?.createPage ?? (async () => (await getSharedBrowserContext()).newPage());
    this.closePage = options?.closePage ?? (async (page) => page.close());
  }

  async getConversation({ clientUsername, limit = 20 }: GetConversationInput): Promise<ConversationResult> {
    const page = await this.createPage();
    try {
      const authed = await checkVGenAuthStatus(page);
      if (!authed) throw new SessionExpiredError();

      const { threadId, url } = await openThread(page, clientUsername);
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
      if (!targetUrl && input.clientUsername) {
        const thread = await openThread(page, input.clientUsername);
        targetUrl = thread.url;
      }
      if (!targetUrl) {
        throw new Error('Either conversationUrl or clientUsername must be provided to sendMessage');
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

      const profileEl = targetPage.locator(CREATOR_PROFILE_MARKER).first();
      const visible = await profileEl.isVisible().catch(() => false);
      if (visible) {
        const text = (await profileEl.innerText().catch(() => ''))?.trim();
        if (text) return text.replace(/^@/, '');

        const alt = (await profileEl.getAttribute('alt').catch(() => ''))?.trim();
        if (alt) return alt.replace(/^@/, '');

        const dataUser = (await profileEl.getAttribute('data-username').catch(() => ''))?.trim();
        if (dataUser) return dataUser.replace(/^@/, '');

        const href = await profileEl.getAttribute('href').catch(() => null);
        if (href) {
          const match = href.match(/\/creator\/([A-Za-z0-9_-]+)/);
          if (match?.[1]) return match[1];
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
