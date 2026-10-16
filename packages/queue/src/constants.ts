export const STREAMS = {
  EVENTS: 'client-agent:events',
  NOTIFICATIONS: 'client-agent:notifications',
  AGENT: 'client-agent:agent',
  BROWSER: 'client-agent:browser',
  SEND: 'client-agent:send',
  SYNC: 'client-agent:sync',
} as const;

export type StreamName = typeof STREAMS[keyof typeof STREAMS];

export const RETRY_ZSET_KEY = 'client-agent:retry_tasks';
export const BACKOFF_DELAYS = [2_000, 10_000, 30_000, 60_000];

