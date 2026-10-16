import type { TaskType } from './enums';

export enum VGenEventType {
  NEW_MESSAGE = 'new_message',
  NEW_COMMISSION = 'new_commission',
  COMMISSION_CONFIRMED = 'commission_confirmed',
  COMMISSION_UPDATED = 'commission_updated',
  COMMISSION_COMPLETED = 'commission_completed',
  UNKNOWN = 'unknown',
}

export interface VGenParsedEvent {
  source: 'gmail';
  provider: 'vgen';
  eventType: VGenEventType;
  externalId: string;
  clientUsername: string | null;
  commissionId: string | null;
  from: string;
  subject: string;
  receivedAt: Date;
}

export interface VGenEventPayload {
  subject: string;
  from: string;
  date: string;
  clientUsername: string | null;
  commissionId: string | null;
  historyId: string;
}

export interface TaskStreamMessage {
  type: TaskType;
  taskId: string;
}
