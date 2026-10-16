import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { isVGenSender, parseVGenEmail } from '../src/parser';

const email = (subject: string, overrides: Partial<{ id: string; from: string; date: string }> = {}) => ({
  id: 'msg-1',
  subject,
  from: 'VGen <no-reply@vgen.co>',
  date: '2026-10-16T14:32:11.000Z',
  ...overrides,
});

describe('VGen email parser', () => {
  it('parses a new message notification with the client username', () => {
    const parsed = parseVGenEmail(email('@ErianOsamu sent you a new message!'));
    expect(parsed).toMatchObject({
      source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE,
      externalId: 'msg-1', clientUsername: 'ErianOsamu', commissionId: null,
    });
    expect(parsed!.receivedAt.toISOString()).toBe('2026-10-16T14:32:11.000Z');
  });

  it('parses a new commission request with the client username', () => {
    const parsed = parseVGenEmail(email('New commission request from @ErianOsamu'));
    expect(parsed!.eventType).toBe(VGenEventType.NEW_COMMISSION);
    expect(parsed!.clientUsername).toBe('ErianOsamu');
  });

  it('parses commission status emails with the commission id', () => {
    expect(parseVGenEmail(email('Commission #VG-1234 updated')))
      .toMatchObject({ eventType: VGenEventType.COMMISSION_UPDATED, commissionId: 'VG-1234', clientUsername: null });
    expect(parseVGenEmail(email('Commission #VG-1234 confirmed'))!.eventType).toBe(VGenEventType.COMMISSION_CONFIRMED);
    expect(parseVGenEmail(email('Commission #VG-1234 completed'))!.eventType).toBe(VGenEventType.COMMISSION_COMPLETED);
  });

  it('keeps an unrecognised VGen subject as unknown instead of dropping it', () => {
    const parsed = parseVGenEmail(email('Your VGen weekly digest'));
    expect(parsed).not.toBeNull();
    expect(parsed!.eventType).toBe(VGenEventType.UNKNOWN);
    expect(parsed!.clientUsername).toBeNull();
  });

  it('ignores non-VGen senders and spoofed domains', () => {
    expect(parseVGenEmail(email('@ErianOsamu sent you a new message!', { from: 'someone@gmail.com' }))).toBeNull();
    expect(parseVGenEmail(email('@ErianOsamu sent you a new message!', { from: 'no-reply@vgen.co.evil.com' }))).toBeNull();
    expect(isVGenSender('no-reply@vgen.co')).toBeTrue();
    expect(isVGenSender('VGen <hello@VGEN.CO>')).toBeTrue();
    expect(isVGenSender('noreply@vgen.co.evil.com')).toBeFalse();
  });

  it('ignores an email with no message id', () => {
    expect(parseVGenEmail(email('@ErianOsamu sent you a new message!', { id: '' }))).toBeNull();
  });

  it('falls back to ingestion time when the Date header is unparseable', () => {
    const before = Date.now();
    const parsed = parseVGenEmail(email('@ErianOsamu sent you a new message!', { date: 'not-a-date' }));
    expect(parsed!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
