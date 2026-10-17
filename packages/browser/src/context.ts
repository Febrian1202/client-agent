import { chromium, type BrowserContext } from 'playwright';
import { resolve } from 'path';
import { config } from '@client-agent/config';

export interface LaunchPersistentContextOptions {
  profilePath?: string;
  headless?: boolean;
}

export async function launchPersistentContext(
  options?: LaunchPersistentContextOptions,
): Promise<BrowserContext> {
  const rawPath = options?.profilePath ?? config.BROWSER_PROFILE_PATH;
  const resolvedPath = resolve(rawPath);
  return chromium.launchPersistentContext(resolvedPath, {
    headless: options?.headless ?? true,
    viewport: { width: 1440, height: 900 },
  });
}

let sharedContext: BrowserContext | null = null;

export async function getSharedBrowserContext(): Promise<BrowserContext> {
  if (!sharedContext) {
    sharedContext = await launchPersistentContext();
  }
  return sharedContext;
}

export async function closeSharedBrowserContext(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
  }
}
