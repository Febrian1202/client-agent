import { parseConfig, type AppConfig } from './schema';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export * from './schema';

let cachedConfig: AppConfig | null = null;

function loadRootEnv() {
  if (process.env.DATABASE_URL) return;

  // Search up for .env
  let currentDir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const envPath = resolve(currentDir, '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith("'") && val.endsWith("'")) ||
              (val.startsWith('"') && val.endsWith('"'))
            ) {
              val = val.slice(1, -1);
            }
            val = val.replaceAll('\\$', '$');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      }
      break;
    }
    currentDir = resolve(currentDir, '..');
  }
}

export function resetConfig(): void {
  cachedConfig = null;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    loadRootEnv();
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

export const config = new Proxy({} as AppConfig, {
  get(_target, prop: string | symbol) {
    return getConfig()[prop as keyof AppConfig];
  },
});
