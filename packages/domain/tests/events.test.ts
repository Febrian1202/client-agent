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

  it('pins the contract shapes for events, payloads, and stream messages', () => {
    const parsedEvent = {
      source: 'gmail',
      provider: 'vgen',
      eventType: VGenEventType.NEW_MESSAGE,
      externalId: 'ext-1',
      clientUsername: 'client1',
      commissionId: null,
      from: 'VGen <no-reply@vgen.co>',
      subject: 'New message',
      receivedAt: new Date(),
    } satisfies import('../src/index').VGenParsedEvent;

    const payload = {
      subject: 'New message',
      from: 'VGen <no-reply@vgen.co>',
      date: '2026-10-16T14:32:11.000Z',
      clientUsername: 'client1',
      commissionId: null,
      historyId: '123',
    } satisfies import('../src/index').VGenEventPayload;

    const message = {
      type: TaskType.PROCESS_GMAIL_EVENT,
      taskId: 'task-1',
    } satisfies import('../src/index').TaskStreamMessage;

    expect(parsedEvent.source).toBe('gmail');
    expect(payload.historyId).toBe('123');
    expect(message.taskId).toBe('task-1');
  });
});
