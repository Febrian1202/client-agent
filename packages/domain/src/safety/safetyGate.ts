import { createHash } from 'crypto';
import type { Approval, Client, Conversation, Draft } from '../entities';
import { ApprovalAction, ApprovalStatus, DraftStatus } from '../enums';

export interface PreSendCheckParams {
  draft: Draft;
  conversation: Conversation;
  client: Client;
  activeApproval: Approval | null;
  expectedApprovalHash?: string | null;
  authenticatedCreatorUsername?: string | null;
  expectedCreatorUsername: string;
  latestInboundMessageSentAt?: Date | null;
  computeHash?: (content: string) => string;
}

export interface SafetyCheckResult {
  allowed: boolean;
  failedCheck?: number;
  reason?: string;
}

export function computeDraftHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function verifyPreSendConditions(params: PreSendCheckParams): SafetyCheckResult {
  // Check 1: Target Conversation Exists and matches vgen
  if (
    !params.conversation ||
    params.conversation.platform.toLowerCase() !== 'vgen' ||
    params.conversation.id !== params.draft.conversationId
  ) {
    return {
      allowed: false,
      failedCheck: 1,
      reason: 'Check 1 Failed: Target conversation does not exist or platform is not vgen',
    };
  }

  // Check 2: Target Client Exists and matches conversation
  if (
    !params.client ||
    params.client.id !== params.conversation.clientId ||
    !params.client.username
  ) {
    return {
      allowed: false,
      failedCheck: 2,
      reason: 'Check 2 Failed: Target client does not exist or does not match conversation',
    };
  }

  // Check 3: Authenticated Account Match
  const expectedUser = params.expectedCreatorUsername.toLowerCase().replace(/^@/, '');
  const activeUser = (params.authenticatedCreatorUsername ?? '').toLowerCase().replace(/^@/, '');
  if (!activeUser || activeUser !== expectedUser) {
    return {
      allowed: false,
      failedCheck: 3,
      reason: `Check 3 Failed: Active VGen account (@${activeUser || 'none'}) does not match expected creator (@${expectedUser})`,
    };
  }

  // Check 4: Draft Status is Strictly APPROVED
  if (params.draft.status !== DraftStatus.APPROVED) {
    return {
      allowed: false,
      failedCheck: 4,
      reason: `Check 4 Failed: Draft status is '${params.draft.status}', expected 'approved'`,
    };
  }

  // Check 5: Content Unchanged
  const hashFn = params.computeHash ?? computeDraftHash;
  const currentHash = hashFn(params.draft.content);
  const recordedHash = params.expectedApprovalHash ?? params.activeApproval?.contentHash;
  if (!recordedHash || currentHash !== recordedHash) {
    return {
      allowed: false,
      failedCheck: 5,
      reason: 'Check 5 Failed: Draft content has changed since approval (hash mismatch)',
    };
  }

  // Check 6: Active Approval Validity
  if (
    !params.activeApproval ||
    params.activeApproval.status !== ApprovalStatus.ACTIVE ||
    params.activeApproval.action !== ApprovalAction.APPROVE ||
    params.activeApproval.draftId !== params.draft.id
  ) {
    return {
      allowed: false,
      failedCheck: 6,
      reason: 'Check 6 Failed: No valid active approval record found for draft',
    };
  }

  // Check 7: Conversation Freshness
  if (params.latestInboundMessageSentAt && params.draft.createdAt) {
    const inboundTime = new Date(params.latestInboundMessageSentAt).getTime();
    const draftTime = new Date(params.draft.createdAt).getTime();
    if (inboundTime > draftTime) {
      return {
        allowed: false,
        failedCheck: 7,
        reason: 'Check 7 Failed: New inbound client message was received after draft generation',
      };
    }
  }

  return { allowed: true };
}
