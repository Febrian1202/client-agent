import { VGenEventType } from '@client-agent/domain';

export interface DiscordEventNotification {
  eventType: VGenEventType;
  clientUsername: string | null;
  commissionId: string | null;
  subject: string;
  receivedAt: Date;
}

const EVENT_LABELS: Record<VGenEventType, string> = {
  [VGenEventType.NEW_MESSAGE]: 'New VGen Message',
  [VGenEventType.NEW_COMMISSION]: 'New Commission Request',
  [VGenEventType.COMMISSION_CONFIRMED]: 'Commission Confirmed',
  [VGenEventType.COMMISSION_UPDATED]: 'Commission Updated',
  [VGenEventType.COMMISSION_COMPLETED]: 'Commission Completed',
  [VGenEventType.UNKNOWN]: 'Unknown VGen Event',
};

export function formatUtcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatEventNotification(event: DiscordEventNotification): string {
  const label = EVENT_LABELS[event.eventType];
  const lines = [
    `🔔 ${label}`,
    '',
    `Client: ${event.clientUsername ? `@${event.clientUsername}` : 'unknown'}`,
  ];

  if (event.commissionId) {
    lines.push(`Commission: ${event.commissionId}`);
  }

  lines.push(
    `Event: ${label}`,
    `Received: ${formatUtcMinute(event.receivedAt)}`,
    '',
    'The notification email does not contain the conversation content.',
  );

  return lines.join('\n');
}
