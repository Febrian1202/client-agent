import { describe, test, expect } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'node:fs';
import { launchPersistentContext } from '@client-agent/browser';
import { VGenBrowserAdapter } from '../src/adapter';
import { SessionExpiredError, ClientNotFoundError } from '../src/errors';
import { AUTH_MARKER_SELECTOR } from '@client-agent/browser';

const fixturesDir = join(import.meta.dir, 'fixtures');
const inboxHtml = readFileSync(join(fixturesDir, 'inbox.html'), 'utf8');
const loginHtml = readFileSync(join(fixturesDir, 'login.html'), 'utf8');
const threadHtml = readFileSync(join(fixturesDir, 'thread.html'), 'utf8');

function makeDashboardHtml(withInbox = true) {
  // Strip the wrapping [] from the CSS attribute selector to build a valid HTML attribute
  const attr = AUTH_MARKER_SELECTOR.replace(/^\[|\]$/g, '');
  return `<html><body><img ${attr} src="/avatar.png" />${withInbox ? inboxHtml : ''}</body></html>`;
}

async function makeIsolatedCtx() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vgen-adapter-'));
  return launchPersistentContext({ profilePath: tmpDir });
}

const TEST_TIMEOUT = 60_000;

describe('VGenBrowserAdapter.getConversation', () => {
  test(
    'Case 1 (success): returns ConversationResult with 3 messages for ErianOsamu',
    async () => {
      const ctx = await makeIsolatedCtx();
      const page = await ctx.newPage();

      await page.route('**/vgen.co/**', (route) => {
        const url = route.request().url();
        if (url.includes('/creator') || url.includes('/dashboard')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: makeDashboardHtml() });
        } else if (url.includes('/inbox/abc123')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: threadHtml });
        } else if (url.includes('/inbox')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: inboxHtml });
        } else if (url.includes('/login')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: loginHtml });
        } else {
          route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
        }
      });

      let closePageCalled = false;
      const adapter = new VGenBrowserAdapter({
        createPage: async () => page,
        closePage: async (p) => {
          closePageCalled = true;
          await p.close();
        },
      });

      const result = await adapter.getConversation({ clientUsername: 'ErianOsamu', limit: 20 });

      expect(result.externalId).toBe('abc123');
      expect(result.externalUrl).toContain('/inbox/abc123');
      expect(result.clientUsername).toBe('ErianOsamu');
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]!.sentAt).toBeInstanceOf(Date);
      expect(result.messages[1]!.sentAt).toBeNull();
      const ids = result.messages.map((m) => m.externalId);
      expect(ids[0]).toBeString();
      expect(ids[1]).toBeString();
      expect(ids[2]).toBeString();
      expect(new Set(ids).size).toBe(3);
      expect(closePageCalled).toBe(true);

      await ctx.close();
    },
    TEST_TIMEOUT,
  );

  test(
    'Case 2 (expired): throws SessionExpiredError when dashboard redirects to /login',
    async () => {
      const ctx = await makeIsolatedCtx();
      const page = await ctx.newPage();

      await page.route('**/vgen.co/**', (route) => {
        const url = route.request().url();
        if (url.includes('/login')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: loginHtml });
        } else {
          route.fulfill({
            status: 302,
            headers: { location: 'https://vgen.co/login' },
            body: '',
          });
        }
      });

      let closePageCalled = false;
      const adapter = new VGenBrowserAdapter({
        createPage: async () => page,
        closePage: async (p) => {
          closePageCalled = true;
          await p.close();
        },
      });

      await expect(
        adapter.getConversation({ clientUsername: 'ErianOsamu' }),
      ).rejects.toBeInstanceOf(SessionExpiredError);
      expect(closePageCalled).toBe(true);

      await ctx.close();
    },
    TEST_TIMEOUT,
  );

  test(
    'Case 3 (unknown user): throws ClientNotFoundError when username not in inbox',
    async () => {
      const ctx = await makeIsolatedCtx();
      const page = await ctx.newPage();

      await page.route('**/vgen.co/**', (route) => {
        const url = route.request().url();
        if (url.includes('/creator') || url.includes('/dashboard')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: makeDashboardHtml() });
        } else if (url.includes('/inbox')) {
          route.fulfill({ status: 200, contentType: 'text/html', body: inboxHtml });
        } else {
          route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
        }
      });

      let closePageCalled = false;
      const adapter = new VGenBrowserAdapter({
        createPage: async () => page,
        closePage: async (p) => {
          closePageCalled = true;
          await p.close();
        },
      });

      await expect(
        adapter.getConversation({ clientUsername: 'NoSuchUser' }),
      ).rejects.toBeInstanceOf(ClientNotFoundError);
      expect(closePageCalled).toBe(true);

      await ctx.close();
    },
    TEST_TIMEOUT,
  );

  test(
    'Case 4 (DI): createPage/closePage spies are called on success AND on error paths',
    async () => {
      const ctx = await makeIsolatedCtx();
      try {
        // Success path: closePage called in finally
        {
          const page = await ctx.newPage();

          await page.route('**/vgen.co/**', (route) => {
            const url = route.request().url();
            if (url.includes('/creator') || url.includes('/dashboard')) {
              route.fulfill({ status: 200, contentType: 'text/html', body: makeDashboardHtml() });
            } else if (url.includes('/inbox/abc123')) {
              route.fulfill({ status: 200, contentType: 'text/html', body: threadHtml });
            } else if (url.includes('/inbox')) {
              route.fulfill({ status: 200, contentType: 'text/html', body: inboxHtml });
            } else {
              route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
            }
          });

          let createPageCalls = 0;
          let closePageCalls = 0;
          const adapter = new VGenBrowserAdapter({
            createPage: async () => { createPageCalls++; return page; },
            closePage: async (p) => { closePageCalls++; await p.close(); },
          });

          await adapter.getConversation({ clientUsername: 'ErianOsamu', limit: 20 });
          expect(createPageCalls).toBe(1);
          expect(closePageCalls).toBe(1);
        }

        // Error path (expired): closePage still called in finally
        {
          const page = await ctx.newPage();

          await page.route('**/vgen.co/**', (route) => {
            route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>not logged in</body></html>' });
          });

          let closePageCalls = 0;
          const adapter = new VGenBrowserAdapter({
            createPage: async () => page,
            closePage: async (p) => { closePageCalls++; await p.close(); },
          });

          await expect(
            adapter.getConversation({ clientUsername: 'ErianOsamu' }),
          ).rejects.toBeInstanceOf(SessionExpiredError);
          expect(closePageCalls).toBe(1);
        }
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

