import { describe, expect, it } from 'bun:test';
import { SendAmbiguousError, SessionExpiredError } from '../src/errors';
import { sendMessageOnPage } from '../src/send';
import { VGenBrowserAdapter } from '../src/adapter';

describe('VGen Send Message Automation', () => {
  it('types text, clicks send, and verifies newest message bubble', async () => {
    let typedText = '';
    let sendClicked = false;
    const mockPage: any = {
      url: () => 'https://vgen.co/inbox/thread-123',
      goto: async () => {},
      waitForLoadState: async () => {},
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async () => {},
          fill: async (val: string) => {
            typedText = val;
          },
          click: async () => {
            sendClicked = true;
          },
          isVisible: async () => true,
          innerText: async () => typedText,
          getAttribute: async (attr: string) => (attr === 'data-message-id' ? 'msg-999' : null),
        }),
        last: () => ({
          waitFor: async () => {},
          innerText: async () => typedText,
          getAttribute: async (attr: string) => (attr === 'data-message-id' ? 'msg-999' : null),
        }),
        all: async () => [
          {
            evaluate: async () =>
              `<div data-testid="thread-message"><div data-testid="message-body">${typedText}</div></div>`,
          },
        ],
      }),
      waitForTimeout: async () => {},
    };

    const result = await sendMessageOnPage(mockPage, {
      conversationUrl: 'https://vgen.co/inbox/thread-123',
      content: 'Hello via automated send!',
    });

    expect(result.success).toBe(true);
    expect(typedText).toBe('Hello via automated send!');
    expect(sendClicked).toBe(true);
  });

  it('reloads and throws SendAmbiguousError when send times out and message is absent', async () => {
    let reloadCalled = false;
    const mockPage: any = {
      url: () => 'https://vgen.co/inbox/thread-123',
      goto: async () => {},
      waitForLoadState: async () => {},
      reload: async () => {
        reloadCalled = true;
      },
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async () => {},
          fill: async () => {},
          click: async () => {
            throw new Error('Timeout 30000ms exceeded');
          },
          isVisible: async () => true,
        }),
        last: () => ({
          waitFor: async () => {
            throw new Error('Timeout');
          },
          innerText: async () => 'Old message from yesterday',
        }),
        all: async () => [],
      }),
      waitForTimeout: async () => {},
    };

    await expect(
      sendMessageOnPage(mockPage, {
        conversationUrl: 'https://vgen.co/inbox/thread-123',
        content: 'Hello via automated send!',
      }),
    ).rejects.toThrow(SendAmbiguousError);

    expect(reloadCalled).toBe(true);
  });

  it('reloads and recovers successfully when send times out but message is present in DOM after reload', async () => {
    let reloadCalled = false;
    const mockPage: any = {
      url: () => 'https://vgen.co/inbox/thread-123',
      goto: async () => {},
      waitForLoadState: async () => {},
      reload: async () => {
        reloadCalled = true;
      },
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async () => {},
          fill: async () => {},
          click: async () => {
            throw new Error('Network timeout during send click');
          },
          isVisible: async () => true,
        }),
        last: () => ({
          waitFor: async () => {
            throw new Error('Timeout');
          },
          innerText: async () => 'Old message',
        }),
        all: async () => [
          {
            innerText: async () => 'Recovered content message',
            getAttribute: async (attr: string) => (attr === 'data-message-id' ? 'recovered-msg-1' : null),
          },
        ],
      }),
      waitForTimeout: async () => {},
    };

    const result = await sendMessageOnPage(mockPage, {
      conversationUrl: 'https://vgen.co/inbox/thread-123',
      content: 'Recovered content message',
    });

    expect(reloadCalled).toBe(true);
    expect(result.success).toBe(true);
    expect(result.messageId).toContain('vgen_recovered_');
  });

  describe('VGenBrowserAdapter sendMessage and getAuthenticatedUsername', () => {
    it('sendMessage succeeds using conversationUrl', async () => {
      let pageClosed = false;
      let sentContent = '';
      const mockPage: any = {
        url: () => 'https://vgen.co/inbox/thread-abc',
        goto: async () => {},
        waitForLoadState: async () => {},
        locator: (selector: string) => ({
          first: () => ({
            waitFor: async () => {},
            fill: async (val: string) => {
              sentContent = val;
            },
            click: async () => {},
            isVisible: async () => true,
            innerText: async () => 'Test creator message',
            getAttribute: async () => 'msg-123',
          }),
          last: () => ({
            waitFor: async () => {},
            innerText: async () => 'Test creator message',
            getAttribute: async (attr: string) => (attr === 'data-message-id' ? 'msg-123' : null),
          }),
          all: async () => [],
        }),
        waitForTimeout: async () => {},
      };

      const adapter = new VGenBrowserAdapter({
        createPage: async () => mockPage,
        closePage: async () => {
          pageClosed = true;
        },
      });

      // Mock auth status check by mocking locator or behavior
      // Note: checkVGenAuthStatus checks user-avatar on creator page
      mockPage.locator = (selector: string) => ({
        first: () => ({
          waitFor: async () => {},
          fill: async (val: string) => {
            sentContent = val;
          },
          click: async () => {},
          isVisible: async () => true,
          innerText: async () => 'Test creator message',
          getAttribute: async () => 'msg-123',
        }),
        last: () => ({
          waitFor: async () => {},
          innerText: async () => 'Test creator message',
          getAttribute: async (attr: string) => (attr === 'data-message-id' ? 'msg-123' : null),
        }),
        all: async () => [],
      });

      const res = await adapter.sendMessage({
        conversationId: 'conv-123',
        conversationUrl: 'https://vgen.co/inbox/thread-abc',
        content: 'Test creator message',
      });

      expect(res.success).toBe(true);
      expect(sentContent).toBe('Test creator message');
      expect(pageClosed).toBe(true);
    });

    it('sendMessage throws Error when neither conversationUrl nor clientUsername is provided', async () => {
      const mockPage: any = {
        url: () => 'https://vgen.co/creator',
        goto: async () => {},
        locator: () => ({
          first: () => ({
            isVisible: async () => true,
          }),
        }),
      };

      const adapter = new VGenBrowserAdapter({
        createPage: async () => mockPage,
        closePage: async () => {},
      });

      await expect(
        adapter.sendMessage({
          conversationId: 'conv-123',
          content: 'Test message',
        }),
      ).rejects.toThrow('Either conversationUrl or clientUsername must be provided');
    });

    it('getAuthenticatedUsername extracts username from profile elements or returns null', async () => {
      const mockPage: any = {
        url: () => 'https://vgen.co/creator',
        goto: async () => {},
        locator: (selector: string) => ({
          first: () => ({
            isVisible: async () => true,
            innerText: async () => '@r1daz_',
            getAttribute: async () => null,
          }),
        }),
      };

      const adapter = new VGenBrowserAdapter({
        createPage: async () => mockPage,
        closePage: async () => {},
      });

      const username = await adapter.getAuthenticatedUsername(mockPage);
      expect(username).toBe('r1daz_');
    });
  });
});
