import { describe, test, expect } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  launchPersistentContext,
  getSharedBrowserContext,
  closeSharedBrowserContext,
} from '../src/context';
import { checkVGenAuthStatus, AUTH_MARKER_SELECTOR } from '../src/session';

// --- Spike: Bun + Playwright compat gate ---

describe('Spike: Bun + Playwright compat', () => {
  test('launches persistent context, sets content, evaluates DOM', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'browser-spike-'));
    const ctx = await launchPersistentContext({ profilePath: tmpDir });
    const page = await ctx.newPage();
    await page.setContent('<p id="x">ok</p>');
    const text = await page.evaluate(() => document.querySelector('#x')?.textContent);
    expect(text).toBe('ok');
    await ctx.close();
  });
});

// --- Auth status: three route-intercepted cases ---

describe('checkVGenAuthStatus', () => {
  async function makeIsolatedPage() {
    const tmpDir = mkdtempSync(join(tmpdir(), 'browser-auth-'));
    const ctx = await launchPersistentContext({ profilePath: tmpDir });
    return { ctx, page: await ctx.newPage() };
  }

  test('returns true when auth marker is present in dashboard HTML', async () => {
    const { ctx, page } = await makeIsolatedPage();
    await page.route('**/vgen.co/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body><img ${AUTH_MARKER_SELECTOR.slice(1, -1)} src="/avatar.png" /></body></html>`,
      });
    });
    const result = await checkVGenAuthStatus(page);
    expect(result).toBe(true);
    await ctx.close();
  });

  test('returns false when dashboard redirects to /login', async () => {
    const { ctx, page } = await makeIsolatedPage();
    await page.route('**/vgen.co/**', (route) => {
      const url = route.request().url();
      if (url.includes('/login')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<html><body><h1>Login</h1></body></html>`,
        });
      } else {
        route.fulfill({
          status: 302,
          headers: { location: 'https://vgen.co/login' },
          body: '',
        });
      }
    });
    const result = await checkVGenAuthStatus(page);
    expect(result).toBe(false);
    await ctx.close();
  });

  test('returns false when dashboard HTML has no auth marker', async () => {
    const { ctx, page } = await makeIsolatedPage();
    await page.route('**/vgen.co/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body><p>Welcome to vgen</p></body></html>`,
      });
    });
    const result = await checkVGenAuthStatus(page);
    expect(result).toBe(false);
    await ctx.close();
  });
});

// --- Shared context lifecycle ---

describe('getSharedBrowserContext / closeSharedBrowserContext', () => {
  test('closeSharedBrowserContext is safe when context was never started', async () => {
    await expect(closeSharedBrowserContext()).resolves.toBeUndefined();
  });

  test('getSharedBrowserContext returns a context (lazy init)', async () => {
    const ctx = await getSharedBrowserContext();
    expect(ctx).toBeDefined();
    await closeSharedBrowserContext();
  });

  test('getSharedBrowserContext returns the same instance on repeated calls', async () => {
    const ctx1 = await getSharedBrowserContext();
    const ctx2 = await getSharedBrowserContext();
    expect(ctx1).toBe(ctx2);
    await closeSharedBrowserContext();
  });
});
