import { VGenEventType, type VGenParsedEvent } from '@client-agent/domain';

export interface VGenEmailInput {
  id: string;
  subject: string;
  from: string;
  date: string;
}

const NEW_MESSAGE_SUBJECT = /^@?([A-Za-z0-9_]+)\s+sent you a new message!?$/i;
const NEW_COMMISSION_SUBJECT = /^New commission request from\s+@?([A-Za-z0-9_]+)/i;
const COMMISSION_UPDATED_SUBJECT = /^Commission #([A-Za-z0-9-]+)\s+updated/i;
const COMMISSION_CONFIRMED_SUBJECT = /^Commission #([A-Za-z0-9-]+)\s+confirmed/i;
const COMMISSION_COMPLETED_SUBJECT = /^Commission #([A-Za-z0-9-]+)\s+completed/i;

const DISPLAY_NAME_WRAPPER = /^[^<]*<([^>]+)>\s*$/;
const VGEN_ADDRESS = /@vgen\.co$/;

export function isVGenSender(from: string): boolean {
  const address = from.toLowerCase().replace(DISPLAY_NAME_WRAPPER, '$1').trim();
  return VGEN_ADDRESS.test(address);
}

export function parseVGenEmail(email: VGenEmailInput): VGenParsedEvent | null {
  if (email.id === '' || !isVGenSender(email.from)) {
    return null;
  }

  const subject = email.subject.trim();
  let eventType = VGenEventType.UNKNOWN;
  let clientUsername: string | null = null;
  let commissionId: string | null = null;

  const newMessage = NEW_MESSAGE_SUBJECT.exec(subject);
  const newCommission = NEW_COMMISSION_SUBJECT.exec(subject);
  const updated = COMMISSION_UPDATED_SUBJECT.exec(subject);
  const confirmed = COMMISSION_CONFIRMED_SUBJECT.exec(subject);
  const completed = COMMISSION_COMPLETED_SUBJECT.exec(subject);

  if (newMessage) {
    eventType = VGenEventType.NEW_MESSAGE;
    clientUsername = newMessage[1] ?? null;
  } else if (newCommission) {
    eventType = VGenEventType.NEW_COMMISSION;
    clientUsername = newCommission[1] ?? null;
  } else if (updated) {
    eventType = VGenEventType.COMMISSION_UPDATED;
    commissionId = updated[1] ?? null;
  } else if (confirmed) {
    eventType = VGenEventType.COMMISSION_CONFIRMED;
    commissionId = confirmed[1] ?? null;
  } else if (completed) {
    eventType = VGenEventType.COMMISSION_COMPLETED;
    commissionId = completed[1] ?? null;
  }

  const headerDate = new Date(email.date);
  const receivedAt = Number.isNaN(headerDate.getTime()) ? new Date() : headerDate;

  return {
    source: 'gmail',
    provider: 'vgen',
    eventType,
    externalId: email.id,
    clientUsername,
    commissionId,
    from: email.from,
    subject,
    receivedAt,
  };
}
