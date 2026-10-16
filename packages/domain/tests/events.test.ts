import { describe, expect, it } from 'bun:test';
import { TaskType, VGenEventType } from '../src/index';

describe('VGen event contracts', () => {
  it('stores lowercase snake_case event types matching events.event_type', () => {
    expect(VGenEventType.NEW_MESSAGE as string).toBe('new_message');
    expect(VGenEventType.NEW_COMMISSION as string).toBe('new_commission');
    expect(VGenEventType.COMMISSION_CONFIRMED as string).toBe('commission_confirmed');
    expect(VGenEventType.COMMISSION_UPDATED as string).toBe('commission_updated');
    expect(VGenEventType.COMMISSION_COMPLETED as string).toBe('commission_completed');
    expect(VGenEventType.UNKNOWN as string).toBe('unknown');
  });

  it('keeps stream messages on existing TaskType values', () => {
    expect(TaskType.PROCESS_GMAIL_EVENT as string).toBe('PROCESS_GMAIL_EVENT');
    expect(TaskType.NOTIFY_DISCORD as string).toBe('NOTIFY_DISCORD');
  });
});
