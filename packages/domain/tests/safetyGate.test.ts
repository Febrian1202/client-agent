import { describe, expect, it } from 'bun:test';
import {
  computeDraftHash,
  verifyPreSendConditions,
  type PreSendCheckParams,
} from '../src';
import { ApprovalAction, ApprovalStatus, DraftStatus } from '../src/enums';

describe('7-Point Safety Gate', () => {
  const content = 'Hello client, here is your update!';
  const contentHash = computeDraftHash(content);
  const now = new Date();
  const past = new Date(now.getTime() - 10_000);

  const validParams: PreSendCheckParams = {
    draft: {
      id: 1,
      conversationId: 10,
      content,
      status: DraftStatus.APPROVED,
      createdAt: now,
      updatedAt: now,
    },
    conversation: {
      id: 10,
      clientId: 100,
      platform: 'vgen',
      externalId: 'vgen_conv_1',
      status: 'active',
      createdAt: past,
      updatedAt: past,
    },
    client: {
      id: 100,
      userId: 1,
      platform: 'vgen',
      username: 'artclient',
      createdAt: past,
      updatedAt: past,
    },
    activeApproval: {
      id: 5,
      draftId: 1,
      userId: 1,
      action: ApprovalAction.APPROVE,
      status: ApprovalStatus.ACTIVE,
      contentHash,
      createdAt: now,
      updatedAt: now,
    },
    authenticatedCreatorUsername: 'r1daz_',
    expectedCreatorUsername: 'r1daz_',
    latestInboundMessageSentAt: past,
  };

  it('passes when all 7 conditions are satisfied', () => {
    const result = verifyPreSendConditions(validParams);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('fails Check 1 when conversation platform is not vgen or ID mismatch', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      conversation: { ...validParams.conversation, platform: 'twitter' },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(1);
  });

  it('fails Check 2 when client does not match conversation clientId', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      client: { ...validParams.client, id: 999 },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(2);
  });

  it('fails Check 3 when authenticated account in browser does not match expected creator', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      authenticatedCreatorUsername: 'impostor_artist',
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(3);
  });

  it('fails Check 4 when draft status is not approved', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      draft: { ...validParams.draft, status: DraftStatus.PENDING_APPROVAL },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(4);
  });

  it('fails Check 4 when draft is null or undefined', () => {
    const resultNull = verifyPreSendConditions({
      ...validParams,
      draft: null as any,
    });
    expect(resultNull.allowed).toBe(false);
    expect(resultNull.failedCheck).toBe(4);
    expect(resultNull.reason).toContain('Draft does not exist or is null');

    const resultUndefined = verifyPreSendConditions({
      ...validParams,
      draft: undefined as any,
    });
    expect(resultUndefined.allowed).toBe(false);
    expect(resultUndefined.failedCheck).toBe(4);
  });

  it('fails Check 5 when draft content hash does not match approval hash', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      draft: { ...validParams.draft, content: 'Tampered content!' },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(5);
  });

  it('fails Check 6 when active approval is missing or revoked', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      activeApproval: { ...validParams.activeApproval!, status: ApprovalStatus.REVOKED },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(6);
  });

  it('fails Check 7 when latest inbound client message is newer than draft creation', () => {
    const future = new Date(now.getTime() + 5_000);
    const result = verifyPreSendConditions({
      ...validParams,
      latestInboundMessageSentAt: future,
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(7);
  });

  it('fails Check 1 when conversation ID does not match draft conversationId', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      conversation: { ...validParams.conversation, id: 999 },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(1);
  });

  it('fails Check 2 when client username is missing', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      client: { ...validParams.client, username: '' },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(2);
  });

  it('passes Check 3 when usernames have leading @ and case differences', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      authenticatedCreatorUsername: '@R1Daz_',
      expectedCreatorUsername: 'r1daz_',
    });
    expect(result.allowed).toBe(true);
  });

  it('passes Check 5 using expectedApprovalHash override', () => {
    const customContent = 'Updated approved message';
    const customHash = computeDraftHash(customContent);
    const result = verifyPreSendConditions({
      ...validParams,
      draft: { ...validParams.draft, content: customContent },
      expectedApprovalHash: customHash,
    });
    expect(result.allowed).toBe(true);
  });

  it('fails Check 6 when active approval draftId does not match draft ID', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      activeApproval: { ...validParams.activeApproval!, draftId: 999 },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(6);
  });

  it('fails Check 6 when active approval action is reject', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      activeApproval: { ...validParams.activeApproval!, action: ApprovalAction.REJECT },
    });
    expect(result.allowed).toBe(false);
    expect(result.failedCheck).toBe(6);
  });

  it('passes Check 7 when latest inbound message is null or undefined', () => {
    const result = verifyPreSendConditions({
      ...validParams,
      latestInboundMessageSentAt: null,
    });
    expect(result.allowed).toBe(true);
  });
});

