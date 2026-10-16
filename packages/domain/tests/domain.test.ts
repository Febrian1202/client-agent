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
    expect(TaskStatus.QUEUED).toBe('queued');
    expect(TaskStatus.RUNNING).toBe('running');
    expect(TaskStatus.COMPLETED).toBe('completed');
    expect(TaskStatus.FAILED).toBe('failed');
    expect(TaskStatus.DEAD).toBe('dead');
  });

  it('defines correct TaskType values', () => {
    expect(TaskType.PROCESS_GMAIL_EVENT).toBe('PROCESS_GMAIL_EVENT');
    expect(TaskType.NOTIFY_DISCORD).toBe('NOTIFY_DISCORD');
    expect(TaskType.READ_VGEN_CONVERSATION).toBe('READ_VGEN_CONVERSATION');
    expect(TaskType.SEND_VGEN_MESSAGE).toBe('SEND_VGEN_MESSAGE');
  });

  it('defines correct DraftStatus values', () => {
    expect(DraftStatus.PENDING_APPROVAL).toBe('pending_approval');
    expect(DraftStatus.APPROVED).toBe('approved');
    expect(DraftStatus.REJECTED).toBe('rejected');
    expect(DraftStatus.SENT).toBe('sent');
  });

  it('defines correct CommissionStatus values', () => {
    expect(CommissionStatus.REQUESTED).toBe('requested');
    expect(CommissionStatus.IN_PROGRESS).toBe('in_progress');
    expect(CommissionStatus.COMPLETED).toBe('completed');
  });

  it('defines correct EventStatus and AuditAction values', () => {
    expect(EventStatus.RECEIVED).toBe('received');
    expect(EventStatus.PROCESSED).toBe('processed');
    expect(AuditAction.USER_APPROVED_DRAFT).toBe('USER_APPROVED_DRAFT');
    expect(AuditAction.MESSAGE_SENT).toBe('MESSAGE_SENT');
  });
});
