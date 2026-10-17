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

  async sendMessage(
    _input: { conversationId: string; content: string },
  ): Promise<{ success: boolean; messageId: string }> {
    throw new NotSupportedError('sendMessage');
  }
}
