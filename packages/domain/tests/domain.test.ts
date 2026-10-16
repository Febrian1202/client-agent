import { describe, expect, it } from 'bun:test';
import {
  AuditAction,
  CommissionStatus,
  DraftStatus,
  EventStatus,
  TaskStatus,
  TaskType,
} from '../src/index';

describe('Domain Enums and Types', () => {
  it('defines correct TaskStatus values', () => {
    expect(TaskStatus.QUEUED).toBe(TaskStatus.QUEUED);
    expect(TaskStatus.RUNNING).toBe(TaskStatus.RUNNING);
    expect(TaskStatus.COMPLETED).toBe(TaskStatus.COMPLETED);
    expect(TaskStatus.FAILED).toBe(TaskStatus.FAILED);
    expect(TaskStatus.DEAD).toBe(TaskStatus.DEAD);
  });

  it('defines correct TaskType values', () => {
    expect(TaskType.PROCESS_GMAIL_EVENT).toBe(TaskType.PROCESS_GMAIL_EVENT);
    expect(TaskType.NOTIFY_DISCORD).toBe(TaskType.NOTIFY_DISCORD);
    expect(TaskType.READ_VGEN_CONVERSATION).toBe(TaskType.READ_VGEN_CONVERSATION);
    expect(TaskType.SEND_VGEN_MESSAGE).toBe(TaskType.SEND_VGEN_MESSAGE);
  });

  it('defines correct DraftStatus values', () => {
    expect(DraftStatus.PENDING_APPROVAL).toBe(DraftStatus.PENDING_APPROVAL);
    expect(DraftStatus.APPROVED).toBe(DraftStatus.APPROVED);
    expect(DraftStatus.REJECTED).toBe(DraftStatus.REJECTED);
    expect(DraftStatus.SENT).toBe(DraftStatus.SENT);
  });

  it('defines correct CommissionStatus values', () => {
    expect(CommissionStatus.REQUESTED).toBe(CommissionStatus.REQUESTED);
    expect(CommissionStatus.IN_PROGRESS).toBe(CommissionStatus.IN_PROGRESS);
    expect(CommissionStatus.COMPLETED).toBe(CommissionStatus.COMPLETED);
  });

  it('defines correct EventStatus and AuditAction values', () => {
    expect(EventStatus.RECEIVED).toBe(EventStatus.RECEIVED);
    expect(EventStatus.PROCESSED).toBe(EventStatus.PROCESSED);
    expect(AuditAction.USER_APPROVED_DRAFT).toBe(AuditAction.USER_APPROVED_DRAFT);
    expect(AuditAction.MESSAGE_SENT).toBe(AuditAction.MESSAGE_SENT);
  });
});
