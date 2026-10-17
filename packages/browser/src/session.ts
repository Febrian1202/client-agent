import { type Page } from 'playwright';

const VGEN_DASHBOARD_URL = 'https://vgen.co/dashboard';

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
  return page.locator(AUTH_MARKER_SELECTOR).isVisible();
}
