# Phase 5 — Approval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a strict human-in-the-loop approval workflow for message drafts, complete with state machine transitions, approval invalidation upon editing, REST API endpoints, and interactive Discord action buttons (`[Approve ✅]`, `[Edit ✏️]`, `[Reject ❌]`) and editing modals.

**Architecture:** Database-backed state machine for drafts and approvals. AI worker creates drafts with status `PENDING_APPROVAL` linked to conversation and agent runs, delivering them with Discord ActionRow buttons. Creator actions via Discord interactions (buttons/modals) or Elysia REST API drive state transitions. Any edit to draft content immediately revokes existing approvals and resets status to `PENDING_APPROVAL`. Immutable audit logs capture every state change.

**Tech Stack:** Bun workspaces, TypeScript, PostgreSQL, Drizzle ORM, Elysia + TypeBox, discord.js v14 (ActionRow, Buttons, Modals), `bun:test`.

**Spec:** `docs/phase/phase-5-approval-system.md` (authoritative spec), `docs/DATA_MODEL.md` (drafts, approvals, audits), `docs/API.md` (draft endpoints), `AGENTS.md` (safety constraints & audit rules).

---

## Global Constraints

- **Human-in-the-Loop for External Writes:** An unapproved draft can NEVER be sent externally.
- **Approval Invalidation:** If a draft is edited after approval, the approval is immediately revoked (`status` reverts to `pending_approval`, active approvals set to `revoked`, `approved_by` and `approved_at` cleared).
- **Audit Immutability:** `audit_logs` table is strictly append-only; rows are never updated or deleted. Every approval, rejection, draft creation, and edit must record an audit entry.
- **Pure Domain Boundary:** Keep `@client-agent/domain` pure and decoupled from framework/database dependencies. Use interfaces/repositories to decouple domain business logic from PostgreSQL/Drizzle implementations.
- **Queue-First / Non-Blocking:** Discord gateway interaction events and Elysia HTTP handlers must not perform long-running blocking operations.
- **Character Limits:** Discord messages and modals enforce a 2000-character cap. Draft content validation must enforce `maxLength: 2000`.

---

## Review Focus

1. **Approval Invalidation on Content Edit:** When an `approved` draft is edited via API `PATCH /drafts/:id` or Discord Modal submit, its status must revert to `pending_approval`, `approved_by` and `approved_at` must become `null`, and previous active approval records in `approvals` must be marked `revoked`.
2. **Terminal / Disallowed State Transitions:** A draft in `sent` status cannot be edited, approved, or rejected (must return HTTP 409 Conflict). Rejecting an already `rejected` draft or approving an already `approved` draft must be handled deterministically.
3. **Discord Gateway Interaction Timing:** Button clicks and modal submissions must respond or defer within Discord's 3-second deadline (`interaction.update()` or `interaction.showModal()`).
4. **Draft Creation Persistence in Worker:** The reply draft worker task (`handleGenerateReplyDraft`) must reliably persist the generated draft into `drafts` with `conversation_id` and `agent_run_id`, then send Discord message with button components containing `customId: "<action>_draft:<draftId>"`.
5. **Audit Trail Completeness:** All draft state changes (`AGENT_GENERATED_DRAFT`, `USER_APPROVED_DRAFT`, `USER_REJECTED_DRAFT`, `USER_EDITED_DRAFT`) must be persisted to `audit_logs` with correct `targetId: draft.id` and `actorType`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/drafts.ts` | Drizzle schema for `drafts` table |
| `packages/db/src/schema/approvals.ts` | Drizzle schema for `approvals` table |
| `packages/db/src/schema/index.ts` (modify) | Re-export `drafts` and `approvals` schemas and types |
| `packages/db/src/queries/drafts.ts` | Database queries for drafts, approvals, and context queries |
| `packages/db/src/queries/index.ts` (modify) | Export draft and approval query functions |
| `packages/db/tests/drafts.test.ts` | Unit tests for drafts & approvals queries |
| `packages/domain/src/enums.ts` (modify) | Ensure `DraftStatus`, `ApprovalAction`, `ApprovalStatus`, `AuditAction` are defined |
| `packages/domain/src/entities.ts` (modify) | Verify `Draft`, `Approval` entities match DB schema |
| `packages/domain/src/services/draftService.ts` | Pure state machine & domain service for draft lifecycle |
| `packages/domain/src/index.ts` (modify) | Export draft service types, interfaces, and functions |
| `packages/domain/tests/draftService.test.ts` | Unit tests for state machine transitions & invalidation |
| `apps/api/src/routes/drafts.ts` | REST API routes for draft CRUD, approve, and reject |
| `apps/api/src/app.ts` (modify) | Mount `/api/v1/drafts` route plugin |
| `apps/api/tests/drafts.test.ts` | REST API endpoint integration tests |
| `packages/discord/src/components/draftButtons.ts` | Discord ActionRow button and modal builders |
| `packages/discord/src/interactions/draftInteractions.ts` | Button click and modal submit interaction handlers |
| `packages/discord/src/bot.ts` (modify) | Extend router to handle Button & ModalSubmit interactions |
| `packages/discord/src/client.ts` (modify) | Extend `DiscordMessenger` to support Discord components |
| `packages/discord/src/index.ts` (modify) | Export draft components and interaction handlers |
| `packages/discord/tests/draft-components.test.ts` | Unit tests for Discord button/modal builders and router |
| `apps/worker/src/handlers/generateReplyDraft.ts` (modify) | Save generated draft to DB, attach Discord buttons |
| `apps/worker/src/bot.ts` (modify) | Route draft button & modal interactions to domain/db handlers |
| `apps/worker/tests/reply-draft-approval.test.ts` | Handler tests for draft creation & Discord button flow |
| `tests/e2e-approval-system.test.ts` | Full end-to-end integration test of Phase 5 workflow |

---

### Task 1: Database Schemas & Queries for Drafts and Approvals

**Files:**
- Create: `packages/db/src/schema/drafts.ts`
- Create: `packages/db/src/schema/approvals.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/queries/drafts.ts`
- Modify: `packages/db/src/queries/index.ts`
- Test: `packages/db/tests/drafts.test.ts`

**Interfaces:**
- Consumes: `conversations` (`packages/db/src/schema/conversations.ts`), `agentRuns` (`packages/db/src/schema/agent_runs.ts`), `users` (`packages/db/src/schema/users.ts`).
- Produces:
  - Tables: `drafts`, `approvals`
  - Types: `DraftRow`, `InsertDraftRow`, `ApprovalRow`, `InsertApprovalRow`
  - Queries: `insertDraft`, `getDraftById`, `listDrafts`, `updateDraft`, `insertApproval`, `revokeApprovalsForDraft`, `getApprovalsByDraftId`, `getDraftWithContext`

- [ ] **Step 1: Write the failing schema and query test**

In `packages/db/tests/drafts.test.ts`:
```ts
import { describe, expect, it, afterAll } from 'bun:test';
import {
  getOwnerUserId,
  insertClient,
  insertConversation,
  insertDraft,
  getDraftById,
  listDrafts,
  updateDraft,
  insertApproval,
  revokeApprovalsForDraft,
  getApprovalsByDraftId,
} from '../src';

describe('drafts and approvals schema & queries', () => {
  it('creates draft in pending_approval status, records approval, and revokes it on edit', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `test_client_${Date.now()}`,
    });
    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `conv_${Date.now()}`,
    });

    // 1. Insert draft
    const draft = await insertDraft({
      conversationId: conv.id,
      content: 'Original draft content',
      status: 'pending_approval',
    });
    expect(draft.id).toBeDefined();
    expect(draft.status).toBe('pending_approval');
    expect(draft.content).toBe('Original draft content');

    // 2. Fetch by id and list
    const fetched = await getDraftById(draft.id);
    expect(fetched?.id).toBe(draft.id);
    const draftsList = await listDrafts({ conversationId: conv.id });
    expect(draftsList.length).toBeGreaterThanOrEqual(1);

    // 3. Insert approval
    const approval = await insertApproval({
      draftId: draft.id,
      userId: ownerId,
      action: 'approve',
      status: 'active',
    });
    expect(approval.status).toBe('active');
    expect(approval.action).toBe('approve');

    // 4. Update draft to approved
    const approvedDraft = await updateDraft(draft.id, {
      status: 'approved',
      approvedBy: ownerId,
      approvedAt: new Date(),
    });
    expect(approvedDraft?.status).toBe('approved');
    expect(approvedDraft?.approvedBy).toBe(ownerId);

    // 5. Revoke approval and reset draft
    await revokeApprovalsForDraft(draft.id);
    const approvals = await getApprovalsByDraftId(draft.id);
    expect(approvals[0].status).toBe('revoked');

    const resetDraft = await updateDraft(draft.id, {
      content: 'Updated draft content',
      status: 'pending_approval',
      approvedBy: null,
      approvedAt: null,
    });
    expect(resetDraft?.status).toBe('pending_approval');
    expect(resetDraft?.content).toBe('Updated draft content');
    expect(resetDraft?.approvedBy).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/drafts.test.ts`
Expected: FAIL — cannot resolve `insertDraft`, `getDraftById`, etc.

- [ ] **Step 3: Define schemas in `packages/db/src/schema/`**

Create `packages/db/src/schema/drafts.ts`:
```ts
import { bigserial, bigint, text, varchar, timestamp, pgTable } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';
import { agentRuns } from './agent_runs';
import { users } from './users';

export const drafts = pgTable('drafts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  conversationId: bigint('conversation_id', { mode: 'number' })
    .notNull()
    .references(() => conversations.id),
  agentRunId: bigint('agent_run_id', { mode: 'number' })
    .references(() => agentRuns.id),
  content: text('content').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending_approval'),
  approvedBy: bigint('approved_by', { mode: 'number' })
    .references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type DraftRow = typeof drafts.$inferSelect;
export type InsertDraftRow = typeof drafts.$inferInsert;
```

Create `packages/db/src/schema/approvals.ts`:
```ts
import { bigserial, bigint, varchar, timestamp, pgTable } from 'drizzle-orm/pg-core';
import { drafts } from './drafts';
import { users } from './users';

export const approvals = pgTable('approvals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  draftId: bigint('draft_id', { mode: 'number' })
    .notNull()
    .references(() => drafts.id),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  action: varchar('action', { length: 50 }).notNull(), // 'approve' | 'reject'
  status: varchar('status', { length: 50 }).notNull().default('active'), // 'active' | 'revoked'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ApprovalRow = typeof approvals.$inferSelect;
export type InsertApprovalRow = typeof approvals.$inferInsert;
```

Update `packages/db/src/schema/index.ts`:
Export `drafts`, `approvals`, and their Row types.

- [ ] **Step 4: Create queries in `packages/db/src/queries/drafts.ts` and export in `queries/index.ts`**

Implement:
- `insertDraft(data: InsertDraftRow)`
- `getDraftById(id: number)`
- `listDrafts(filter?: { status?: string; conversationId?: number; limit?: number; offset?: number })`
- `updateDraft(id: number, data: Partial<InsertDraftRow>)`
- `insertApproval(data: InsertApprovalRow)`
- `revokeApprovalsForDraft(draftId: number)`
- `getApprovalsByDraftId(draftId: number)`
- `getDraftWithContext(id: number)` (joins draft, conversation, and active approvals)

- [ ] **Step 5: Run Drizzle migration and verify tests pass**

Run:
```bash
bun run --filter=@client-agent/db db:generate
bun run --filter=@client-agent/db db:migrate
bun test packages/db/tests/drafts.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/drafts.ts packages/db/src/schema/approvals.ts packages/db/src/schema/index.ts packages/db/src/queries/drafts.ts packages/db/src/queries/index.ts packages/db/drizzle packages/db/tests/drafts.test.ts
git commit -m "feat(db): add drafts and approvals schema, migrations, and queries"
```

---

### Task 2: Pure Domain Service for Draft State Machine in `packages/domain`

**Files:**
- Modify: `packages/domain/src/enums.ts`
- Modify: `packages/domain/src/entities.ts`
- Create: `packages/domain/src/services/draftService.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/draftService.test.ts`

**Interfaces:**
- Consumes: `Draft`, `Approval`, `DraftStatus`, `AuditAction` from `@client-agent/domain`.
- Produces:
  - `DraftRepository` interface
  - `createDraft(repo, params)`
  - `approveDraft(repo, params)`
  - `rejectDraft(repo, params)`
  - `updateDraftContent(repo, params)`
  - Error classes: `DraftNotFoundError`, `InvalidDraftStateError`, `DraftContentEmptyError`

- [ ] **Step 1: Write the failing domain service test**

In `packages/domain/tests/draftService.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import {
  DraftStatus,
  DraftService,
  type DraftRepository,
  type Draft,
  type Approval,
  InvalidDraftStateError,
} from '../src';

describe('DraftService domain logic', () => {
  function createMockRepo(initialDraft?: Draft): { repo: DraftRepository; state: { drafts: Draft[]; approvals: Approval[]; audits: any[] } } {
    const state = {
      drafts: initialDraft ? [initialDraft] : [],
      approvals: [] as Approval[],
      audits: [] as any[],
    };
    const repo: DraftRepository = {
      async getDraftById(id) {
        return state.drafts.find((d) => d.id === id) ?? null;
      },
      async createDraft(data) {
        const d: Draft = {
          id: state.drafts.length + 1,
          conversationId: data.conversationId,
          agentRunId: data.agentRunId ?? null,
          content: data.content,
          status: DraftStatus.PENDING_APPROVAL,
          approvedBy: null,
          approvedAt: null,
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.drafts.push(d);
        return d;
      },
      async updateDraft(id, data) {
        const d = state.drafts.find((item) => item.id === id);
        if (!d) return null;
        Object.assign(d, data, { updatedAt: new Date() });
        return d;
      },
      async insertApproval(data) {
        const a: Approval = {
          id: state.approvals.length + 1,
          draftId: data.draftId,
          userId: data.userId,
          action: data.action,
          status: data.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.approvals.push(a);
        return a;
      },
      async revokeApprovalsForDraft(draftId) {
        for (const a of state.approvals) {
          if (a.draftId === draftId) a.status = 'revoked';
        }
      },
      async insertAuditLog(log) {
        state.audits.push(log);
      },
    };
    return { repo, state };
  }

  it('creates draft in PENDING_APPROVAL status', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    expect(draft.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(state.drafts[0].content).toBe('Hello client');
  });

  it('approves a pending draft and records approval + audit log', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    
    const approved = await service.approveDraft({ draftId: draft.id, userId: 1 });
    expect(approved.status).toBe(DraftStatus.APPROVED);
    expect(approved.approvedBy).toBe(1);
    expect(approved.approvedAt).toBeDefined();
    expect(state.approvals.length).toBe(1);
    expect(state.approvals[0].action).toBe('approve');
    expect(state.approvals[0].status).toBe('active');
  });

  it('revokes active approval and reverts to PENDING_APPROVAL when content is edited', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    await service.approveDraft({ draftId: draft.id, userId: 1 });

    const updated = await service.updateDraftContent({ draftId: draft.id, newContent: 'Updated message', userId: 1 });
    expect(updated.status).toBe(DraftStatus.PENDING_APPROVAL);
    expect(updated.content).toBe('Updated message');
    expect(updated.approvedBy).toBeNull();
    expect(updated.approvedAt).toBeNull();
    expect(state.approvals[0].status).toBe('revoked');
  });

  it('rejects an approved or pending draft', async () => {
    const { repo, state } = createMockRepo();
    const service = new DraftService(repo);
    const draft = await service.createDraft({ conversationId: 10, content: 'Hello client' });
    await service.approveDraft({ draftId: draft.id, userId: 1 });

    const rejected = await service.rejectDraft({ draftId: draft.id, userId: 1, reason: 'Tone too casual' });
    expect(rejected.status).toBe(DraftStatus.REJECTED);
    expect(state.approvals.find((a) => a.action === 'approve')?.status).toBe('revoked');
    expect(state.approvals.find((a) => a.action === 'reject')?.status).toBe('active');
  });

  it('throws InvalidDraftStateError when attempting to edit or approve a SENT draft', async () => {
    const initial: Draft = {
      id: 99,
      conversationId: 10,
      content: 'Already sent',
      status: DraftStatus.SENT,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { repo } = createMockRepo(initial);
    const service = new DraftService(repo);

    expect(service.approveDraft({ draftId: 99, userId: 1 })).rejects.toThrow(InvalidDraftStateError);
    expect(service.updateDraftContent({ draftId: 99, newContent: 'New', userId: 1 })).rejects.toThrow(InvalidDraftStateError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/domain/tests/draftService.test.ts`
Expected: FAIL — `DraftService` and error classes not defined.

- [ ] **Step 3: Implement `DraftService` in `packages/domain/src/services/draftService.ts`**

Define:
- Errors: `DraftNotFoundError`, `InvalidDraftStateError`, `DraftContentEmptyError`
- Repository contract: `DraftRepository`
- Service class `DraftService` with methods:
  - `createDraft(params: { conversationId: number; content: string; agentRunId?: number | null })`
  - `approveDraft(params: { draftId: number; userId: number })`
  - `rejectDraft(params: { draftId: number; userId: number; reason?: string })`
  - `updateDraftContent(params: { draftId: number; newContent: string; userId: number })`
- Export from `packages/domain/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/domain/tests/draftService.test.ts`
Expected: PASS

- [ ] **Step 5: Provide DB Repository Adapter in `packages/db`**

In `packages/db/src/queries/drafts.ts`, export `createDbDraftRepository(): DraftRepository` and a ready-to-use `draftService` instance wired to PostgreSQL queries.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/services/draftService.ts packages/domain/src/index.ts packages/domain/tests/draftService.test.ts packages/db/src/queries/drafts.ts
git commit -m "feat(domain): implement pure DraftService state machine and repository contracts"
```

---

### Task 3: Drafts REST API in `apps/api`

**Files:**
- Create: `apps/api/src/routes/drafts.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/drafts.test.ts`

**Interfaces:**
- Consumes: `DraftService`, `createDbDraftRepository` from `@client-agent/db` & `@client-agent/domain`.
- Produces:
  - `GET /api/v1/drafts`: lists drafts with optional `status`, `conversation_id`, `limit`, `offset`.
  - `GET /api/v1/drafts/:id`: gets draft detail with approvals and conversation context.
  - `POST /api/v1/drafts`: creates draft (`{ conversationId, content }`). Returns 201.
  - `PATCH /api/v1/drafts/:id`: edits draft content (`{ content }`). Reverts status to `pending_approval`.
  - `POST /api/v1/drafts/:id/approve`: approves draft. Returns 200.
  - `POST /api/v1/drafts/:id/reject`: rejects draft (`{ reason? }`). Returns 200.

- [ ] **Step 1: Write failing API route test**

In `apps/api/tests/drafts.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { getOwnerUserId, insertClient, insertConversation } from '@client-agent/db';

describe('Drafts API (/api/v1/drafts)', () => {
  it('implements full draft CRUD and state machine transitions', async () => {
    const app = createApp();
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `api_client_${Date.now()}`,
    });
    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `api_conv_${Date.now()}`,
    });

    // 1. Create draft
    const resCreate = await app.handle(
      new Request('http://localhost/api/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, content: 'Initial message' }),
      }),
    );
    expect(resCreate.status).toBe(201);
    const bodyCreate = await resCreate.json();
    const draftId = bodyCreate.draft.id;
    expect(bodyCreate.draft.status).toBe('pending_approval');

    // 2. Get draft
    const resGet = await app.handle(new Request(`http://localhost/api/v1/drafts/${draftId}`));
    expect(resGet.status).toBe(200);
    const bodyGet = await resGet.json();
    expect(bodyGet.draft.id).toBe(draftId);

    // 3. Approve draft
    const resApprove = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/approve`, { method: 'POST' }),
    );
    expect(resApprove.status).toBe(200);
    const bodyApprove = await resApprove.json();
    expect(bodyApprove.draft.status).toBe('approved');
    expect(bodyApprove.draft.approvedBy).toBe(ownerId);

    // 4. Edit draft (must revert to pending_approval and revoke approval)
    const resEdit = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Edited message' }),
      }),
    );
    expect(resEdit.status).toBe(200);
    const bodyEdit = await resEdit.json();
    expect(bodyEdit.draft.status).toBe('pending_approval');
    expect(bodyEdit.draft.content).toBe('Edited message');
    expect(bodyEdit.draft.approvedBy).toBeNull();

    // 5. Reject draft
    const resReject = await app.handle(
      new Request(`http://localhost/api/v1/drafts/${draftId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Not interested' }),
      }),
    );
    expect(resReject.status).toBe(200);
    const bodyReject = await resReject.json();
    expect(bodyReject.draft.status).toBe('rejected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/drafts.test.ts`
Expected: FAIL (404 or route not found).

- [ ] **Step 3: Implement `apps/api/src/routes/drafts.ts` and mount in `apps/api/src/app.ts`**

Define schema validation with TypeBox (`t.Object`, `t.String`, `t.Number`, `t.Optional`):
- `GET /` with query options
- `GET /:id`
- `POST /`
- `PATCH /:id`
- `POST /:id/approve`
- `POST /:id/reject`
Map domain errors (`DraftNotFoundError` -> 404, `InvalidDraftStateError` -> 409) to standard API error responses `{ error: { code, message } }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/drafts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/drafts.ts apps/api/src/app.ts apps/api/tests/drafts.test.ts
git commit -m "feat(api): implement /api/v1/drafts CRUD and state machine endpoints"
```

---

### Task 4: Interactive Discord Action Buttons & Modals

**Files:**
- Create: `packages/discord/src/components/draftButtons.ts`
- Create: `packages/discord/src/interactions/draftInteractions.ts`
- Modify: `packages/discord/src/bot.ts`
- Modify: `packages/discord/src/client.ts`
- Modify: `packages/discord/src/index.ts`
- Test: `packages/discord/tests/draft-components.test.ts`

**Interfaces:**
- Produces:
  - `buildDraftActionRow(draftId: number)`
  - `buildDraftStatusRow(status: string, actorName?: string)`
  - `buildEditDraftModal(draftId: number, currentContent: string)`
  - `handleDraftButtonInteraction(interaction: ButtonInteraction, deps: DraftInteractionDeps)`
  - `handleDraftModalSubmitInteraction(interaction: ModalSubmitInteraction, deps: DraftInteractionDeps)`
  - Extended `DiscordMessenger` with `components` support.

- [ ] **Step 1: Write failing test for Discord components and interaction routing**

In `packages/discord/tests/draft-components.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import {
  buildDraftActionRow,
  buildEditDraftModal,
  handleDraftButtonInteraction,
  handleDraftModalSubmitInteraction,
  type DraftInteractionDeps,
} from '../src';

describe('Discord Draft Buttons and Modals', () => {
  it('builds an ActionRow with Approve, Edit, and Reject buttons', () => {
    const row = buildDraftActionRow(42);
    expect(row.components.length).toBe(3);
    expect((row.components[0].data as any).custom_id).toBe('approve_draft:42');
    expect((row.components[1].data as any).custom_id).toBe('edit_draft:42');
    expect((row.components[2].data as any).custom_id).toBe('reject_draft:42');
  });

  it('builds a modal for editing draft text', () => {
    const modal = buildEditDraftModal(42, 'Existing text');
    expect((modal.data as any).custom_id).toBe('modal_edit_draft:42');
    expect((modal.components[0].components[0].data as any).value).toBe('Existing text');
  });

  it('handles approve button click by invoking service and updating message', async () => {
    let approvedDraftId: number | null = null;
    let updatedPayload: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async ({ draftId }) => {
        approvedDraftId = draftId;
      },
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
      getDraftContent: async () => 'test',
    };

    const mockButtonInteraction: any = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: 'approve_draft:42',
      user: { id: 'user1', username: 'Creator' },
      update: async (payload: any) => {
        updatedPayload = payload;
      },
    };

    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(approvedDraftId).toBe(42);
    expect(updatedPayload.content).toContain('Approved by Creator');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/discord/tests/draft-components.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement Discord components in `packages/discord/src/components/draftButtons.ts`**

Use `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle`, `ModalBuilder`, `TextInputBuilder`, `TextInputStyle` from `discord.js`:
- Button 1: `approve_draft:<draftId>`, Success style, "Approve ✅"
- Button 2: `edit_draft:<draftId>`, Primary style, "Edit ✏️"
- Button 3: `reject_draft:<draftId>`, Danger style, "Reject ❌"
- Modal: `modal_edit_draft:<draftId>` with multiline TextInput `draft_content`.

- [ ] **Step 4: Implement interaction handlers in `packages/discord/src/interactions/draftInteractions.ts`**

Implement `handleDraftButtonInteraction` and `handleDraftModalSubmitInteraction`:
- On `approve_draft:<id>`: call `deps.approveDraft({ draftId, userId })`, update message with confirmation text and remove/disable action buttons.
- On `reject_draft:<id>`: call `deps.rejectDraft({ draftId, userId })`, update message with rejection text.
- On `edit_draft:<id>`: fetch draft text, call `interaction.showModal(buildEditDraftModal(id, content))`.
- On `modal_edit_draft:<id>`: get text from `interaction.fields.getTextInputValue('draft_content')`, call `deps.updateDraftContent({ draftId, newContent, userId })`, update message with new content and fresh action row.

- [ ] **Step 5: Extend `createInteractionRouter` in `packages/discord/src/bot.ts` and `DiscordMessenger` in `client.ts`**

Allow router to dispatch `ButtonInteraction` and `ModalSubmitInteraction` in addition to chat commands.
Allow `DiscordMessenger` methods (`editInteractionFollowup`, `sendChannelMessage`) to optionally accept `components?: unknown[]`.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test packages/discord/tests/draft-components.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/discord/src/components packages/discord/src/interactions packages/discord/src/bot.ts packages/discord/src/client.ts packages/discord/src/index.ts packages/discord/tests/draft-components.test.ts
git commit -m "feat(discord): add interactive draft buttons, edit modal, and interaction router"
```

---

### Task 5: Worker Integration — Reply Draft Pipeline & Discord Bot Wireup

**Files:**
- Modify: `apps/worker/src/handlers/generateReplyDraft.ts`
- Modify: `apps/worker/src/bot.ts`
- Modify: `apps/worker/src/services/discord.ts`
- Test: `apps/worker/tests/reply-draft-approval.test.ts`

**Interfaces:**
- Consumes: `insertDraft`, `createDbDraftRepository`, `buildDraftActionRow`, `handleDraftButtonInteraction`, `handleDraftModalSubmitInteraction`.
- Produces:
  - `generateReplyDraft` creates DB draft row linked to conversation & agent run.
  - Sends/edits Discord message with the draft text + action buttons.
  - Worker Discord bot handles button clicks & modal edits directly.

- [ ] **Step 1: Write failing handler test**

In `apps/worker/tests/reply-draft-approval.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import { handleGenerateReplyDraft } from '../src/handlers/generateReplyDraft';
import {
  createTask,
  getOwnerUserId,
  insertClient,
  insertConversation,
  listDrafts,
} from '@client-agent/db';
import { TaskType, TaskStatus } from '@client-agent/domain';

describe('Generate Reply Draft Worker Integration', () => {
  it('generates draft, saves to drafts table, and emits Discord message with buttons', async () => {
    const ownerId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `reply_test_${Date.now()}`,
    });
    const conv = await insertConversation({
      clientId: client.id,
      platform: 'vgen',
      externalId: `reply_conv_${Date.now()}`,
    });

    const task = await createTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: client.username,
        instruction: 'Confirm commission slot for next month',
        discord: {
          applicationId: 'app123',
          interactionToken: 'token123',
        },
      },
      idempotencyKey: `reply_task_${Date.now()}`,
    });

    let sentComponents: any = null;
    let sentContent: string = '';

    const mockAiClient: any = {
      createChatCompletion: async () => ({
        content: 'Hi! I can confirm your commission slot for next month.',
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        durationMs: 120,
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      }),
    };

    const mockMessenger: any = {
      editInteractionFollowup: async ({ content, components }: any) => {
        sentContent = content;
        sentComponents = components;
        return { messageId: 'msg-1' };
      },
    };

    await handleGenerateReplyDraft(
      {
        id: 'stream-1',
        stream: 'client-agent:agent',
        data: { taskId: String(task.id) },
      },
      {
        aiClient: mockAiClient,
        messenger: mockMessenger,
      },
    );

    // 1. Verify drafts row created in DB
    const drafts = await listDrafts({ conversationId: conv.id });
    expect(drafts.length).toBe(1);
    expect(drafts[0].status).toBe('pending_approval');
    expect(drafts[0].content).toContain('confirm your commission slot');

    // 2. Verify Discord message had action buttons
    expect(sentComponents).toBeDefined();
    expect(sentContent).toContain(client.username);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/reply-draft-approval.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `apps/worker/src/handlers/generateReplyDraft.ts`**

- After LLM creates draft content:
  - Lookup or create conversation for the client.
  - Insert row in `drafts` table:
    `insertDraft({ conversationId: conv.id, agentRunId: agentRun.id, content, status: 'pending_approval' })`.
  - Log audit `AuditAction.AGENT_GENERATED_DRAFT`.
  - Attach `buildDraftActionRow(draft.id).toJSON()` to Discord messenger options.

- [ ] **Step 4: Update `apps/worker/src/bot.ts`**

Wire the interactive button and modal submit router in `startWorkerDiscordBot`:
- When interaction is button matching `_draft:`, call `handleDraftButtonInteraction`.
- When interaction is modal submit matching `modal_edit_draft:`, call `handleDraftModalSubmitInteraction`.
- Delegate to DB/domain service to perform state changes and audit logging.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/worker/tests/reply-draft-approval.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/handlers/generateReplyDraft.ts apps/worker/src/bot.ts apps/worker/src/services/discord.ts apps/worker/tests/reply-draft-approval.test.ts
git commit -m "feat(worker): connect reply draft generation with drafts DB table and Discord action buttons"
```

---

### Task 6: End-to-End System Integration Test & Verification

**Files:**
- Create: `tests/e2e-approval-system.test.ts`

**Interfaces:**
- Tests complete flow:
  Draft Generation → PENDING_APPROVAL → Discord Button Approve → APPROVED → Content Edit (API/Modal) → Approval Revoked & PENDING_APPROVAL → Reject → REJECTED → Audit Logs.

- [ ] **Step 1: Write end-to-end integration test**

In `tests/e2e-approval-system.test.ts`:
Verify the complete approval lifecycle, state transitions, rejection, approval invalidation on edit, and audit log generation against real Postgres and Elysia app.

- [ ] **Step 2: Run the test suite**

Run: `bun test tests/e2e-approval-system.test.ts`
Expected: PASS

- [ ] **Step 3: Run full repository regression test suite**

Run: `bun test`
Expected: All tests pass with zero regressions.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-approval-system.test.ts
git commit -m "test: add comprehensive end-to-end integration test for Phase 5 approval system"
```

---

## Execution Handoff

Please review the implementation plan above. Which execution approach would you prefer?

- **Subagent-driven (Recommended)** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, ensuring rigorous quality gate and separation of concerns.
- **Native** — I implement every task step-by-step myself in this session with verification tests after each task.
