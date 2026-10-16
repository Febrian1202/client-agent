import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { formatEventNotification, formatUtcMinute } from '../src/notifications';

describe('Discord notification formatting', () => {
  it('formats a new message notification', () => {
    const text = formatEventNotification({
      eventType: VGenEventType.NEW_MESSAGE, clientUsername: 'ErianOsamu', commissionId: null,
      subject: '@ErianOsamu sent you a new message!', receivedAt: new Date('2026-10-16T14:32:11.000Z'),
    });
    expect(text).toContain('🔔 New VGen Message');
    expect(text).toContain('Client: @ErianOsamu');
    expect(text).toContain('Event: New VGen Message');
    expect(text).toContain('Received: 2026-10-16 14:32 UTC');
    expect(text).toContain('The notification email does not contain the conversation content.');
  });

  it('adds the commission line and unknown client for commission events', () => {
    const text = formatEventNotification({
      eventType: VGenEventType.COMMISSION_UPDATED, clientUsername: null, commissionId: 'VG-1234',
      subject: 'Commission #VG-1234 updated', receivedAt: new Date('2026-10-16T00:05:00.000Z'),
    });
    expect(text).toContain('Event: Commission Updated');
    expect(text).toContain('Client: unknown');
    expect(text).toContain('Commission: VG-1234');
    expect(text).toContain('Received: 2026-10-16 00:05 UTC');
  });

  it('labels unknown VGen events without pretending to know them', () => {
    const text = formatEventNotification({
      eventType: VGenEventType.UNKNOWN, clientUsername: null, commissionId: null,
      subject: 'Your VGen weekly digest', receivedAt: new Date('2026-10-16T09:00:00.000Z'),
    });
    expect(text).toContain('Unknown VGen Event');
  });

  it('formats to the minute in UTC', () => {
    expect(formatUtcMinute(new Date('2026-01-02T03:04:59.999Z'))).toBe('2026-01-02 03:04 UTC');
  });
});
