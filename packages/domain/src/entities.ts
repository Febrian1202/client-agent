import type {
  ApprovalAction,
  ApprovalStatus,
  CommissionStatus,
  DraftStatus,
  EventStatus,
  TaskStatus,
  TaskType,
} from './enums';

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Client {
  id: number;
  userId: number;
  platform: string;
  externalId?: string | null;
  username: string;
  displayName?: string | null;
  profileUrl?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown>;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: number;
  clientId: number;
  platform: string;
  externalId: string;
  externalUrl?: string | null;
  status: string;
  lastSyncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: number;
  conversationId: number;
  externalId?: string | null;
  direction: 'inbound' | 'outbound';
  senderType: 'client' | 'creator' | 'agent';
  senderName: string;
  content: string;
  metadata?: Record<string, unknown>;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Commission {
  id: number;
  clientId: number;
  externalId?: string | null;
  serviceName: string;
  amount: string;
  currency: string;
  estimatedStart?: string | null;
  guaranteedDelivery?: string | null;
  status: CommissionStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Event {
  id: number;
  source: string;
  provider: string;
  eventType: string;
  externalId: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  receivedAt?: Date | null;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTask {
  id: number;
  userId: number;
  eventId?: number | null;
  type: TaskType;
  status: TaskStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  idempotencyKey?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentRun {
  id: number;
  taskId: number;
  provider: string;
  model: string;
  systemVersion: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  tokenUsage?: number | null;
  durationMs?: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Draft {
  id: number;
  conversationId: number;
  agentRunId?: number | null;
  content: string;
  status: DraftStatus;
  approvedBy?: number | null;
  approvedAt?: Date | null;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Approval {
  id: number;
  draftId: number;
  userId: number;
  action: ApprovalAction | 'approve' | 'reject';
  status: ApprovalStatus | 'active' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: number;
  userId?: number | null;
  actorType: 'user' | 'agent' | 'system';
  actorId?: number | null;
  action: string;
  targetType: string;
  targetId: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: Date;
}
