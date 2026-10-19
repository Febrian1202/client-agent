# Phase 6 — VGen Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely send approved drafts to VGen using Playwright browser automation, protected by the mandatory 7-point safety gate, post-send verification, non-destructive retry handling, and immutable audit logging.

**Architecture:** Elysia REST API exposes `POST /api/v1/drafts/:id/send`, which validates approval and enqueues a `SEND_VGEN_MESSAGE` task to the `client-agent:send` Redis Stream. The Bun worker consumes the stream, executes the 7-Point Safety Gate before touching the browser, delivers the message through Playwright persistent browser context with human-like delays, verifies delivery directly in the DOM, updates message and draft states, and produces immutable audit log entries with Discord confirmation alerts. If a send timeout or network glitch occurs, the worker inspects the conversation DOM instead of blindly retrying, aborting if ambiguous.

**Tech Stack:** Bun, TypeScript, Playwright (persistent context), PostgreSQL, Drizzle ORM, Redis Streams (`@client-agent/queue`), Elysia + TypeBox (`apps/api`), discord.js (`packages/discord`), `bun:test`.

**Spec:** `docs/phase/phase-6-vgen-send.md` (authoritative spec), `AGENTS.md` (7-point safety constraints), `docs/DATA_MODEL.md` (`drafts`, `approvals`, `messages`, `audit_logs`).

---

## Global Constraints

- **Human-in-the-Loop for External Writes:** The agent MUST NEVER send a message on VGen or any external platform without explicit human approval. An unapproved draft cannot be dispatched (`POST /drafts/:id/send` must return HTTP 409).
- **The 7-Point Safety Gate:** Before executing any VGen send action, all 7 checks must pass:
  1. Target conversation exists and matches platform `vgen`.
  2. Target client exists and matches conversation client.
  3. Authenticated VGen account in browser profile matches creator username.
  4. Draft status is strictly `approved`.
  5. Content unchanged: SHA-256 hash matches hash recorded at approval time.
  6. Active approval record exists with `status = 'active'` and `action = 'approve'`.
  7. Conversation state is fresh: no inbound client messages sent after draft creation.
  *If ANY check fails: abort immediately, record `MESSAGE_SEND_ABORTED_SAFETY_CHECK` in `audit_logs`, mark task DEAD, and alert Discord.*
- **No Password Storage & No Anti-Bot Bypassing:** Re-use persistent browser context in `BROWSER_PROFILE_PATH`. Never store credentials.
- **Strict Anti-Goal — No Blind Retries on Ambiguity:** If a send result is ambiguous (timeout, network disconnect), the worker MUST reload the conversation page and inspect the last messages in the DOM. If present, treat as sent; if absent, throw `SendAmbiguousError`, mark task DEAD, and alert creator on Discord. NEVER resend blindly.
- **Audit Log Immutability:** `audit_logs` table is strictly append-only. No updates or deletes. Every send attempt, safety abortion, failure, and success MUST produce an audit record.
- **Queue-First Architecture:** Elysia HTTP route validates, queues to Redis Stream `client-agent:send`, and returns HTTP 202 Accepted. All execution happens in `apps/worker`.

---

## Review Focus

1. **Content Tampering Detection:** A draft is approved, but its text is modified directly in the database before sending. The safety gate computes SHA-256 and detects a hash mismatch against the approval record, aborting the send.
2. **Conversation State Invalidation (Stale Draft):** A client sends a new message after the draft was approved ("Wait, cancel that!"). The freshness check detects the inbound message timestamp is newer than draft creation, blocking dispatch.
3. **Ambiguous Send Recovery Without Duplicate Delivery:** Network disconnects or times out after clicking send. Worker re-inspects DOM. If the message appears, it marks it sent without re-sending. If absent, it halts and marks task DEAD rather than retrying.
4. **Creator Account Mismatch:** The browser profile is logged into a different VGen account or logged out. Check 3 detects the discrepancy from DOM profile marker and blocks send.
5. **Revoked Approval Protection:** An approval was revoked (e.g. content was edited or rejected). Check 6 detects no active approval and aborts before launching Playwright.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/enums.ts` (modify) | Add `AuditAction.MESSAGE_SEND_ABORTED_SAFETY_CHECK` |
| `packages/domain/src/entities.ts` (modify) | Add `contentHash?: string \| null` to `Approval` entity |
| `packages/db/src/schema/approvals.ts` (modify) | Add `contentHash: varchar('content_hash', { length: 64 })` column |
| `packages/domain/src/services/draftService.ts` (modify) | Compute SHA-256 hash on approve and store on `Approval` and `audit_logs.metadata` |
| `packages/domain/tests/draftService.test.ts` (modify) | Verify `approveDraft` records `contentHash` |
| `packages/domain/src/safety/safetyGate.ts` (create) | Pure 7-point safety gate validation logic and hash calculation |
| `packages/domain/src/safety/index.ts` (create) | Re-export safety gate types and functions |
| `packages/domain/src/index.ts` (modify) | Re-export `safety` module |
| `packages/domain/tests/safetyGate.test.ts` (create) | Unit tests covering all 7 checks and failure modes |
| `packages/vgen/src/selectors.ts` (modify) | DOM selectors for message input, send button, and bubbles |
| `packages/vgen/src/errors.ts` (modify) | Add `SendAmbiguousError` and `SafetyCheckFailedError` |
| `packages/vgen/src/send.ts` (create) | Playwright page sending, typing, DOM verification, and ambiguous recovery |
| `packages/vgen/src/adapter.ts` (modify) | Implement `sendMessage` and `getAuthenticatedUsername` |
| `packages/vgen/src/index.ts` (modify) | Export `send.ts` functions and new error classes |
| `packages/vgen/tests/send.test.ts` (create) | Playwright page unit tests for send, verification, and ambiguous recovery |
| `apps/worker/src/handlers/sendVgenMessage.ts` (create) | Worker task handler for `SEND_VGEN_MESSAGE` executing safety checks, send, DB updates, audit logs, and Discord notifications |
| `apps/worker/src/index.ts` (modify) | Add consumer for `STREAMS.SEND` calling `handleSendVgenMessage` |
| `apps/worker/tests/sendVgenMessage.test.ts` (create) | Unit tests for `sendVgenMessage` handler covering safety aborts, ambiguous halt, and happy path |
| `apps/api/src/routes/drafts.ts` (modify) | Implement `POST /api/v1/drafts/:id/send` endpoint |
| `apps/api/tests/draft-send.test.ts` (create) | Integration tests for `POST /api/v1/drafts/:id/send` (404, 409, 202) |
| `tests/e2e-vgen-send.test.ts` (create) | Comprehensive end-to-end integration test of Phase 6 |

---

### Task 1: Content Hash on Approval in DB Schema & Domain

**Files:**
- Modify: `packages/domain/src/enums.ts:56-71`
- Modify: `packages/domain/src/entities.ts:136-144`
- Modify: `packages/db/src/schema/approvals.ts:5-20`
- Modify: `packages/domain/src/services/draftService.ts:45-50,131-175`
- Modify: `packages/db/src/queries/drafts.ts:89-92`
- Test: `packages/domain/tests/draftService.test.ts`

**Interfaces:**
- Consumes: `drafts` table, `approvals` table, Node/Bun `crypto.createHash('sha256')`.
- Produces:
  - `Approval.contentHash`: SHA-256 hex string of approved draft content.
  - `AuditAction.MESSAGE_SEND_ABORTED_SAFETY_CHECK = 'MESSAGE_SEND_ABORTED_SAFETY_CHECK'`.
  - Migration file `0006_add_approval_content_hash.sql`.

- [ ] **Step 1: Write the failing test for content hash recording on approval**

In `packages/domain/tests/draftService.test.ts`:
```ts
it('records contentHash in approval and audit log when draft is approved', async () => {
  const { repo, state } = createMockRepo();
  const service = new DraftService(repo);
  const draft = await service.createDraft({ conversationId: 10, content: 'Approved message text' });

  const approved = await service.approveDraft({ draftId: draft.id, userId: 1 });
  expect(approved.status).toBe(DraftStatus.APPROVED);
  expect(state.approvals.length).toBe(1);
  expect(state.approvals[0]!.contentHash).toBeDefined();
  expect(state.approvals[0]!.contentHash).toHaveLength(64);
  expect(state.audits[0]!.metadata?.contentHash).toBe(state.approvals[0]!.contentHash);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/domain/tests/draftService.test.ts`
Expected: FAIL with `state.approvals[0]!.contentHash is undefined`

- [ ] **Step 3: Implement content hash in domain, schema, and draftService**

1. In `packages/domain/src/enums.ts`, add:
   ```ts
   MESSAGE_SEND_ABORTED_SAFETY_CHECK = 'MESSAGE_SEND_ABORTED_SAFETY_CHECK',
   ```
2. In `packages/domain/src/entities.ts`, update `Approval`:
   ```ts
   export interface Approval {
     id: number;
     draftId: number;
     userId: number;
     action: ApprovalAction | 'approve' | 'reject';
     status: ApprovalStatus | 'active' | 'revoked';
     contentHash?: string | null;
     createdAt: Date;
     updatedAt: Date;
   }
   ```
3. In `packages/db/src/schema/approvals.ts`, add column:
   ```ts
   contentHash: varchar('content_hash', { length: 64 }),
   ```
4. In `packages/domain/src/services/draftService.ts`:
   In `InsertApprovalInput`, add `contentHash?: string | null;`.
   In `approveDraft`:
   ```ts
   import { createHash } from 'crypto';
   ...
   const contentHash = createHash('sha256').update(draft.content).digest('hex');
   await repo.insertApproval({
     draftId: draft.id,
     userId: params.userId,
     action: ApprovalAction.APPROVE,
     status: ApprovalStatus.ACTIVE,
     contentHash,
   });
   await repo.insertAuditLog({
     userId: params.userId,
     actorType: 'user',
     actorId: params.userId,
     action: AuditAction.USER_APPROVED_DRAFT,
     targetType: 'draft',
     targetId: draft.id,
     metadata: { contentHash },
   });
   ```
5. In `packages/db/src/queries/drafts.ts`, ensure `insertApproval` maps `contentHash`.
6. Run `bun run --filter=@client-agent/db db:generate` to generate migration `0006_add_approval_content_hash.sql`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/domain/tests/draftService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain packages/db
git commit -m "feat(domain,db): add contentHash to approvals and auditAction for safety check abort"
```

---

### Task 2: Implement the 7-Point Safety Gate in `@client-agent/domain`

**Files:**
- Create: `packages/domain/src/safety/safetyGate.ts`
- Create: `packages/domain/src/safety/index.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/safetyGate.test.ts`

**Interfaces:**
- Consumes: `Draft`, `Conversation`, `Client`, `Approval`, `DraftStatus`, `ApprovalAction`, `ApprovalStatus`.
- Produces:
  - `computeDraftHash(content: string): string`
  - `verifyPreSendConditions(params: PreSendCheckParams): SafetyCheckResult`
  - `PreSendCheckParams`, `SafetyCheckResult`

- [ ] **Step 1: Write the failing tests for all 7 safety checks**

In `packages/domain/tests/safetyGate.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/domain/tests/safetyGate.test.ts`
Expected: FAIL with module `../src` does not export `verifyPreSendConditions`

- [ ] **Step 3: Implement `packages/domain/src/safety/safetyGate.ts`**

```ts
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
  const currentHash = computeDraftHash(params.draft.content);
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
```

Re-export from `packages/domain/src/safety/index.ts` and `packages/domain/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/domain/tests/safetyGate.test.ts`
Expected: PASS (all 8 tests passing)

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): implement 7-point pre-send safety gate"
```

---

### Task 3: VGen Browser Adapter Send & Post-Send Verification with Ambiguous Recovery

**Files:**
- Modify: `packages/vgen/src/selectors.ts:6-13`
- Modify: `packages/vgen/src/errors.ts:20-27`
- Create: `packages/vgen/src/send.ts`
- Modify: `packages/vgen/src/adapter.ts:66-71`
- Modify: `packages/vgen/src/index.ts`
- Test: `packages/vgen/tests/send.test.ts`

**Interfaces:**
- Consumes: Playwright `Page`, `selectors.ts`, `errors.ts`.
- Produces:
  - `SendAmbiguousError`: Error thrown when send result is unconfirmed after reload and inspection.
  - `SafetyCheckFailedError`: Error thrown if pre-browser safety check fails.
  - `sendMessageOnPage(page: Page, options: SendMessagePageOptions): Promise<{ success: boolean; messageId: string }>`
  - `VGenBrowserAdapter.sendMessage(input: { conversationId: string; content: string; conversationUrl?: string; clientUsername?: string }): Promise<{ success: boolean; messageId: string }>`
  - `VGenBrowserAdapter.getAuthenticatedUsername(page?: Page): Promise<string | null>`

- [ ] **Step 1: Write the failing tests for browser sending and recovery**

In `packages/vgen/tests/send.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import { SendAmbiguousError } from '../src/errors';
import { sendMessageOnPage } from '../src/send';

describe('VGen Send Message Automation', () => {
  it('types text, clicks send, and verifies newest message bubble', async () => {
    let typedText = '';
    let sendClicked = false;
    const mockPage: any = {
      url: () => 'https://vgen.co/inbox/thread-123',
      goto: async () => {},
      waitForLoadState: async () => {},
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async () => {},
          fill: async (val: string) => { typedText = val; },
          click: async () => { sendClicked = true; },
          isVisible: async () => true,
          innerText: async () => typedText,
          getAttribute: async (attr: string) => attr === 'data-message-id' ? 'msg-999' : null,
        }),
        last: () => ({
          waitFor: async () => {},
          innerText: async () => typedText,
          getAttribute: async (attr: string) => attr === 'data-message-id' ? 'msg-999' : null,
        }),
        all: async () => [{
          evaluate: async () => `<div data-testid="thread-message"><div data-testid="message-body">${typedText}</div></div>`,
        }],
      }),
      waitForTimeout: async () => {},
    };

    const result = await sendMessageOnPage(mockPage, {
      conversationUrl: 'https://vgen.co/inbox/thread-123',
      content: 'Hello via automated send!',
    });

    expect(result.success).toBe(true);
    expect(typedText).toBe('Hello via automated send!');
    expect(sendClicked).toBe(true);
  });

  it('reloads and throws SendAmbiguousError when send times out and message is absent', async () => {
    let reloadCalled = false;
    const mockPage: any = {
      url: () => 'https://vgen.co/inbox/thread-123',
      goto: async () => {},
      waitForLoadState: async () => {},
      reload: async () => { reloadCalled = true; },
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async () => {},
          fill: async () => {},
          click: async () => { throw new Error('Timeout 30000ms exceeded'); },
          isVisible: async () => true,
        }),
        last: () => ({
          waitFor: async () => { throw new Error('Timeout'); },
          innerText: async () => 'Old message from yesterday',
        }),
        all: async () => [],
      }),
      waitForTimeout: async () => {},
    };

    expect(
      sendMessageOnPage(mockPage, {
        conversationUrl: 'https://vgen.co/inbox/thread-123',
        content: 'Hello via automated send!',
      })
    ).rejects.toThrow(SendAmbiguousError);

    expect(reloadCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/vgen/tests/send.test.ts`
Expected: FAIL with `SendAmbiguousError` or `sendMessageOnPage` not found

- [ ] **Step 3: Implement `packages/vgen/src/send.ts`, errors, selectors, and adapter**

1. In `packages/vgen/src/selectors.ts`, add:
   ```ts
   export const MESSAGE_INPUT_SELECTOR = '[data-testid="message-input"], textarea[placeholder*="message" i], .str-chat__textarea textarea';
   export const SEND_BUTTON_SELECTOR = '[data-testid="send-button"], button[type="submit"], button:has-text("Send")';
   export const CREATOR_PROFILE_MARKER = '[data-testid="user-username"], [data-testid="user-avatar"] [alt], a[href*="/creator"]';
   ```
2. In `packages/vgen/src/errors.ts`, add:
   ```ts
   export class SendAmbiguousError extends Error {
     constructor(message = 'Message send timed out and delivery could not be confirmed in conversation thread') {
       super(message);
       this.name = 'SendAmbiguousError';
     }
   }

   export class SafetyCheckFailedError extends Error {
     constructor(message: string) {
       super(message);
       this.name = 'SafetyCheckFailedError';
     }
   }
   ```
3. In `packages/vgen/src/send.ts`:
   Implement `sendMessageOnPage(page: Page, options: SendMessagePageOptions)`:
   - Navigate to `conversationUrl` if not already on it.
   - Wait for `MESSAGE_INPUT_SELECTOR` (timeout 10s).
   - Fill textarea cleanly with `options.content`.
   - Click `SEND_BUTTON_SELECTOR` or press Enter.
   - Post-Send Verification:
     - Wait up to 10s for newest message bubble in `THREAD_MESSAGE_SELECTOR`.
     - Check newest bubble contains `options.content.trim()`.
     - If verified, return `{ success: true, messageId: extractedId || `vgen_out_${Date.now()}` }`.
   - Ambiguous Recovery Block:
     - In `catch (err)`:
     - Call `await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})`.
     - Inspect last 5 messages in thread.
     - If any contains `options.content.trim()`, return `{ success: true, messageId: `vgen_recovered_${Date.now()}` }`.
     - Otherwise, throw `new SendAmbiguousError(err instanceof Error ? err.message : String(err))`.
4. In `packages/vgen/src/adapter.ts`:
   Implement `sendMessage`:
   ```ts
   async sendMessage(input: {
     conversationId: string;
     content: string;
     conversationUrl?: string;
     clientUsername?: string;
   }): Promise<{ success: boolean; messageId: string }> {
     const page = await this.createPage();
     try {
       const authed = await checkVGenAuthStatus(page);
       if (!authed) throw new SessionExpiredError();

       let targetUrl = input.conversationUrl;
       if (!targetUrl && input.clientUsername) {
         const thread = await openThread(page, input.clientUsername);
         targetUrl = thread.url;
       }
       if (!targetUrl) {
         throw new Error('Either conversationUrl or clientUsername must be provided to sendMessage');
       }

       return await sendMessageOnPage(page, {
         conversationUrl: targetUrl,
         content: input.content,
       });
     } finally {
       await this.closePage(page);
     }
   }
   ```
   Implement `getAuthenticatedUsername(page?: Page)`: inspects profile elements or returns creator username.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/vgen/tests/send.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vgen
git commit -m "feat(vgen): implement sendMessage automation, post-send verification, and ambiguous recovery"
```

---

### Task 4: Worker Task Handler: `SEND_VGEN_MESSAGE`

**Files:**
- Create: `apps/worker/src/handlers/sendVgenMessage.ts`
- Modify: `apps/worker/src/index.ts:37-81`
- Test: `apps/worker/tests/sendVgenMessage.test.ts`

**Interfaces:**
- Consumes:
  - `packages/db` (`getDraftById`, `getConversationWithClient`, `getApprovalsByDraftId`, `getMessagesByConversationId`, `insertMessagesIfNew`, `updateDraft`, `insertAuditLog`, `markTaskCompleted`, `markTaskDead`)
  - `packages/domain` (`verifyPreSendConditions`, `AuditAction`, `DraftStatus`, `TaskType`)
  - `packages/queue` (`NonRetriableError`, `STREAMS.SEND`)
  - `packages/vgen` (`VGenBrowserAdapter`, `SendAmbiguousError`)
  - `packages/discord` (`DiscordMessenger`)
- Produces:
  - `handleSendVgenMessage(task: ParsedTask, deps: SendVgenMessageDeps): Promise<void>`

- [ ] **Step 1: Write the failing tests for `handleSendVgenMessage`**

In `apps/worker/tests/sendVgenMessage.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import { handleSendVgenMessage, type SendVgenMessageDeps } from '../src/handlers/sendVgenMessage';
import { DraftStatus } from '@client-agent/domain';
import { SendAmbiguousError } from '@client-agent/vgen';

describe('Worker: SEND_VGEN_MESSAGE Handler', () => {
  it('aborts and marks task dead when safety gate check fails', async () => {
    let auditAction = '';
    let taskDead = false;
    let discordAlert = '';

    const mockDeps: any = {
      getDraft: async () => ({ id: 1, conversationId: 10, content: 'Text', status: DraftStatus.PENDING_APPROVAL }), // unapproved!
      getConversation: async () => ({ id: 10, clientId: 100, platform: 'vgen' }),
      getClient: async () => ({ id: 100, username: 'client' }),
      getApprovals: async () => [],
      getLatestInboundMessage: async () => null,
      getCreatorUsername: () => 'r1daz_',
      adapter: { getAuthenticatedUsername: async () => 'r1daz_', sendMessage: async () => ({ success: true, messageId: 'm1' }) },
      insertAuditLog: async (log: any) => { auditAction = log.action; },
      markTaskDead: async () => { taskDead = true; },
      markTaskCompleted: async () => {},
      updateDraft: async () => {},
      insertMessage: async () => {},
      messenger: { sendChannelMessage: async (_ch: string, text: string) => { discordAlert = text; } },
    };

    const task: any = { id: 'stream-1', data: { taskId: 42, draftId: 1 } };
    expect(handleSendVgenMessage(task, mockDeps)).rejects.toThrow();
    expect(taskDead).toBe(true);
    expect(auditAction).toBe('MESSAGE_SEND_ABORTED_SAFETY_CHECK');
    expect(discordAlert).toContain('Safety check blocked send');
  });

  it('marks task dead and halts without retry when adapter throws SendAmbiguousError', async () => {
    let auditAction = '';
    let taskDead = false;

    const mockDeps: any = {
      getDraft: async () => ({
        id: 1,
        conversationId: 10,
        content: 'Text',
        status: DraftStatus.APPROVED,
        createdAt: new Date(),
      }),
      getConversation: async () => ({ id: 10, clientId: 100, platform: 'vgen', externalUrl: 'https://vgen.co/10' }),
      getClient: async () => ({ id: 100, username: 'client' }),
      getApprovals: async () => [{ id: 1, draftId: 1, status: 'active', action: 'approve', contentHash: 'abc' }],
      getLatestInboundMessage: async () => null,
      getCreatorUsername: () => 'r1daz_',
      adapter: {
        getAuthenticatedUsername: async () => 'r1daz_',
        sendMessage: async () => { throw new SendAmbiguousError('DOM timeout'); },
      },
      insertAuditLog: async (log: any) => { auditAction = log.action; },
      markTaskDead: async () => { taskDead = true; },
      markTaskCompleted: async () => {},
      updateDraft: async () => {},
      insertMessage: async () => {},
      messenger: { sendChannelMessage: async () => {} },
      computeHash: () => 'abc',
    };

    const task: any = { id: 'stream-1', data: { taskId: 42, draftId: 1 } };
    expect(handleSendVgenMessage(task, mockDeps)).rejects.toThrow();
    expect(taskDead).toBe(true);
    expect(auditAction).toBe('MESSAGE_SEND_FAILED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/sendVgenMessage.test.ts`
Expected: FAIL with `handleSendVgenMessage` not found

- [ ] **Step 3: Implement `apps/worker/src/handlers/sendVgenMessage.ts` and attach to consumer**

1. Create `apps/worker/src/handlers/sendVgenMessage.ts`:
   - Implement `handleSendVgenMessage(task: ParsedTask, deps?: SendVgenMessageDeps)`:
   - Extract `taskId = Number(task.data.taskId)` and `draftId = Number(task.data.draftId)`.
   - Query DB for draft, conversation with client, approvals, and latest inbound message.
   - Run `verifyPreSendConditions`:
     - If `!safety.allowed`:
       - `await insertAuditLog({ actorType: 'agent', action: AuditAction.MESSAGE_SEND_ABORTED_SAFETY_CHECK, targetType: 'draft', targetId: draftId, metadata: { reason: safety.reason, failedCheck: safety.failedCheck } })`
       - `await markTaskDead(taskId, safety.reason!)`
       - Send Discord notification: `"🛑 Safety check blocked send: [reason]"`
       - Throw `new NonRetriableError(safety.reason!)`
   - Log `AuditAction.AGENT_ATTEMPTED_SEND`.
   - Call `adapter.sendMessage({ conversationId: String(conv.id), content: draft.content, conversationUrl: conv.externalUrl, clientUsername: client.username })`.
   - On success:
     - Insert into `messages`: `direction: 'outbound', senderType: 'creator', senderName: creatorUsername, content: draft.content, sentAt: new Date(), externalId: result.messageId`.
     - Update `drafts`: `status: DraftStatus.SENT, sentAt: new Date()`.
     - Log `AuditAction.MESSAGE_SENT`.
     - Send Discord confirmation: `"🚀 Message successfully delivered to @${client.username} on VGen!"`.
     - `await markTaskCompleted(taskId, { success: true, messageId: result.messageId })`.
   - On `SendAmbiguousError`:
     - Log `AuditAction.MESSAGE_SEND_FAILED` with `{ ambiguous: true, error: err.message }`.
     - `await markTaskDead(taskId, `Ambiguous send: ${err.message}`)`.
     - Send Discord alert: `"⚠️ Message send to @${client.username} is AMBIGUOUS. Please inspect VGen manually before retrying!"`.
     - Throw `new NonRetriableError(err.message)`.
2. In `apps/worker/src/index.ts`:
   Add consumer entry for `STREAMS.SEND`:
   ```ts
   {
     stream: STREAMS.SEND,
     handler: async (task) => {
       const vgenDeps = await resolveVgenWorkerDeps();
       return handleSendVgenMessage(task, {
         adapter: vgenDeps.adapter,
         messenger: vgenDeps.messenger,
       });
     },
   },
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/worker/tests/sendVgenMessage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): implement SEND_VGEN_MESSAGE task handler with safety gating and ambiguous recovery"
```

---

### Task 5: Send Trigger API Endpoint in `apps/api`

**Files:**
- Modify: `apps/api/src/routes/drafts.ts:193-242`
- Test: `apps/api/tests/draft-send.test.ts`

**Interfaces:**
- Consumes: `createTask` (`packages/db`), `publishTask` (`packages/queue`), `STREAMS.SEND`, `TaskType.SEND_VGEN_MESSAGE`.
- Produces:
  - Route `POST /api/v1/drafts/:id/send`:
    - Success: 202 Accepted `{ taskId: number, status: 'queued' }`
    - Not Approved: 409 Conflict `{ error: { code: 'NOT_APPROVED', message: string } }`
    - Not Found: 404 Not Found `{ error: { code: 'DRAFT_NOT_FOUND', message: string } }`

- [ ] **Step 1: Write the failing tests for `POST /api/v1/drafts/:id/send`**

In `apps/api/tests/draft-send.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { db, drafts, users, conversations, clients, insertDraft, insertClient, insertConversation, getOwnerUserId } from '@client-agent/db';
import { DraftStatus } from '@client-agent/domain';

describe('POST /api/v1/drafts/:id/send', () => {
  it('returns 409 Conflict when draft is not approved', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({ userId: ownerId, platform: 'vgen', username: 'test_send_1' });
    const conv = await insertConversation({ clientId: client.id, platform: 'vgen', externalId: 'vgen_send_1' });
    const draft = await insertDraft({ conversationId: conv.id, content: 'Draft text', status: DraftStatus.PENDING_APPROVAL });

    const res = await app.handle(new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, { method: 'POST' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_APPROVED');
  });

  it('returns 202 Accepted and enqueues task when draft is approved', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({ userId: ownerId, platform: 'vgen', username: 'test_send_2' });
    const conv = await insertConversation({ clientId: client.id, platform: 'vgen', externalId: 'vgen_send_2' });
    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Approved draft text',
      status: DraftStatus.APPROVED,
      approvedBy: ownerId,
      approvedAt: new Date(),
    });

    const res = await app.handle(new Request(`http://localhost/api/v1/drafts/${draft.id}/send`, { method: 'POST' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.taskId).toBeDefined();
    expect(body.status).toBe('queued');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/draft-send.test.ts`
Expected: FAIL (route `POST /api/v1/drafts/:id/send` not handled, 404)

- [ ] **Step 3: Implement `POST /api/v1/drafts/:id/send` in `apps/api/src/routes/drafts.ts`**

```ts
.post(
  '/:id/send',
  async ({ params, currentUser, set }) => {
    const draftId = Number(params.id);
    const draft = await getDraftById(draftId);
    if (!draft) {
      set.status = 404;
      return {
        error: {
          code: 'DRAFT_NOT_FOUND',
          message: `Draft with ID ${draftId} not found`,
        },
      };
    }

    if (draft.status !== DraftStatus.APPROVED) {
      set.status = 409;
      return {
        error: {
          code: 'NOT_APPROVED',
          message: 'Draft must be approved before sending',
        },
      };
    }

    const userId = currentUser?.id ?? (await getOwnerUserId());
    const task = await createTask({
      userId,
      type: TaskType.SEND_VGEN_MESSAGE,
      input: { draftId: draft.id, userId },
      idempotencyKey: `send_draft_${draft.id}_${draft.updatedAt.getTime()}`,
    });

    await publishTask(STREAMS.SEND, {
      taskId: task.id,
      draftId: draft.id,
      userId,
    });

    set.status = 202;
    return { taskId: task.id, status: 'queued' };
  },
  {
    params: t.Object({
      id: t.Numeric(),
    }),
  }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/draft-send.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /api/v1/drafts/:id/send endpoint"
```

---

### Task 6: End-to-End Integration Tests for Phase 6

**Files:**
- Create: `tests/e2e-vgen-send.test.ts`
- Modify: `tests/` cleanup routines

**Interfaces:**
- Consumes: Complete flow: `apps/api`, `apps/worker`, `packages/db`, `packages/domain`, `packages/vgen`.
- Produces: Test suite validating all 6 failure and success paths specified in Phase 6.

- [ ] **Step 1: Write `tests/e2e-vgen-send.test.ts`**

Covering:
1. Negative: `POST /drafts/:id/send` on unapproved draft returns 409.
2. Negative: Tampered content after approval -> safety gate fails Check 5, logs `MESSAGE_SEND_ABORTED_SAFETY_CHECK`, task marked DEAD.
3. Negative: Stale draft (inbound client message received after draft created) -> safety gate fails Check 7.
4. Ambiguous recovery: Timeout during send -> re-reads thread DOM -> detects message sent -> completes without double send.
5. Ambiguous failure: Timeout during send -> re-reads thread DOM -> message absent -> throws `SendAmbiguousError`, marks task DEAD, never retries blindly.
6. Positive Happy Path: Draft approved -> `POST /send` -> 7 safety checks pass -> Playwright types & verifies in DOM -> outbound row inserted into `messages` table -> `drafts.status = 'sent'` -> `audit_logs` has `MESSAGE_SENT` -> Discord alert sent.

- [ ] **Step 2: Run test suite**

Run: `bun test tests/e2e-vgen-send.test.ts`
Expected: PASS

- [ ] **Step 3: Run full project test suite and typecheck**

Run:
```bash
bun test
bun run typecheck
```
Expected: All tests pass and typecheck completes with zero errors.

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "test(e2e): add comprehensive Phase 6 VGen Send end-to-end integration test suite"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-19-phase-6-vgen-send.md`.
