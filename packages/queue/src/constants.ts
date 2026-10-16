export const STREAMS = {
  EVENTS: 'client-agent:events',
  NOTIFICATIONS: 'client-agent:notifications',
  AGENT: 'client-agent:agent',
  BROWSER: 'client-agent:browser',
  SEND: 'client-agent:send',
  SYNC: 'client-agent:sync',
} as const;

export type StreamName = typeof STREAMS[keyof typeof STREAMS];
