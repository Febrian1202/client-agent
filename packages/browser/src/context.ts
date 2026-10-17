import { chromium, type BrowserContext } from 'playwright';
import { existsSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { config } from '@client-agent/config';

export interface LaunchPersistentContextOptions {
  profilePath?: string;
  headless?: boolean;
}

export function resolveProfilePath(rawPath: string): string {
  if (isAbsolute(rawPath)) return rawPath;
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, '.git')) || existsSync(resolve(dir, 'bunfig.toml'))) {
      return resolve(dir, rawPath);
    }
    dir = resolve(dir, '..');
  }
  return resolve(rawPath);
}

export async function launchPersistentContext(
  options?: LaunchPersistentContextOptions,
): Promise<BrowserContext> {
  const rawPath = options?.profilePath ?? config.BROWSER_PROFILE_PATH;
  const resolvedPath = resolveProfilePath(rawPath);
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
