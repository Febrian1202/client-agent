import { parseConfig, type AppConfig } from './schema';

export * from './schema';

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

export const config = new Proxy({} as AppConfig, {
  get(_target, prop: string | symbol) {
    return getConfig()[prop as keyof AppConfig];
  },
});
