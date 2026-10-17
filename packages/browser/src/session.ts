import { type Page } from 'playwright';

const VGEN_DASHBOARD_URL = 'https://vgen.co/creator';

export const AUTH_MARKER_SELECTOR = '[data-testid="user-avatar"]';

export async function checkVGenAuthStatus(
  page: Page,
  options?: { dashboardUrl?: string },
): Promise<boolean> {
  const url = options?.dashboardUrl ?? VGEN_DASHBOARD_URL;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    return false;
  }
  const hasMarker = await page.locator(AUTH_MARKER_SELECTOR).first().isVisible().catch(() => false);
  if (hasMarker) return true;
  const hasLiveAuth = await page.locator('svg.chatIcon, button[aria-label="Profile menu"], a[href*="/creator"]').first().isVisible().catch(() => false);
  return hasLiveAuth;
}
