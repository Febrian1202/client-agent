export enum TaskStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DEAD = 'dead',
}

export enum TaskType {
  PROCESS_GMAIL_EVENT = 'PROCESS_GMAIL_EVENT',
  NOTIFY_DISCORD = 'NOTIFY_DISCORD',
  READ_VGEN_CONVERSATION = 'READ_VGEN_CONVERSATION',
  SYNC_CONVERSATION = 'SYNC_CONVERSATION',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  GENERATE_REPLY_DRAFT = 'GENERATE_REPLY_DRAFT',
  SEND_VGEN_MESSAGE = 'SEND_VGEN_MESSAGE',
  SYNC_COMMISSION = 'SYNC_COMMISSION',
}

export enum DraftStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SENT = 'sent',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum ApprovalAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export enum ApprovalStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

export enum CommissionStatus {
  REQUESTED = 'requested',
  ACCEPTED = 'accepted',
  PAID = 'paid',
  IN_PROGRESS = 'in_progress',
  DELIVERED = 'delivered',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum EventStatus {
  RECEIVED = 'received',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

export enum AuditAction {
  USER_CREATED_DRAFT = 'USER_CREATED_DRAFT',
  USER_APPROVED_DRAFT = 'USER_APPROVED_DRAFT',
  USER_REJECTED_DRAFT = 'USER_REJECTED_DRAFT',
  USER_EDITED_DRAFT = 'USER_EDITED_DRAFT',
  AGENT_READ_CONVERSATION = 'AGENT_READ_CONVERSATION',
  AGENT_GENERATED_DRAFT = 'AGENT_GENERATED_DRAFT',
  AGENT_ATTEMPTED_SEND = 'AGENT_ATTEMPTED_SEND',
  MESSAGE_SENT = 'MESSAGE_SENT',
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',
  MESSAGE_SEND_ABORTED_SAFETY_CHECK = 'MESSAGE_SEND_ABORTED_SAFETY_CHECK',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  INTEGRATION_CONNECTED = 'INTEGRATION_CONNECTED',
  INTEGRATION_DISCONNECTED = 'INTEGRATION_DISCONNECTED',
}

export enum MemoryType {
  FACT = 'fact',
  PREFERENCE = 'preference',
  INFERENCE = 'inference',
}

export enum MemoryCategory {
  TECHNICAL = 'technical',
  SCOPE = 'scope',
  ASSETS = 'assets',
  GENERAL = 'general',
  COMMUNICATION = 'communication',
}

export enum MemorySource {
  USER_NOTE = 'user_note',
  CONVERSATION_EXTRACTION = 'conversation_extraction',
  AGENT_INFERENCE = 'agent_inference',
}

export enum MemoryConfidence {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

