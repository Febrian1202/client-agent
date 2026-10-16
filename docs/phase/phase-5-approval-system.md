# Phase 5 — Approval System: Step-by-Step Implementation Guide

> **Goal:** Build the strict human-in-the-loop approval workflow for message drafts, complete with state machine transitions, approval invalidation upon editing, and interactive Discord action buttons (`[Approve]`, `[Edit]`, `[Reject]`).
> **Core Principle:** An unapproved draft can NEVER be sent externally. Any edit to an already-approved draft immediately revokes its approval.
> **Prerequisites:** Phase 4 completed.

---

## Architecture Context for This Phase

```text
AI Agent generates draft
       │
       ▼
Saved to 'drafts' table (status: PENDING_APPROVAL)
       │
       ▼
Discord Embed with Action Buttons:
┌──────────────────────────────────────────────────┐
│ 🤖 Generated Reply Draft for @ErianOsamu         │
│                                                  │
│ "Hi Erian! Thanks for reaching out.              │
│ I can start next week. Commercial use is +50%.   │
│ Does that work for your schedule?"               │
│                                                  │
│ [ Approve ✅ ]     [ Edit ✏️ ]     [ Reject ❌ ]  │
└──────────────────────────────────────────────────┘
       │
       ├─► User clicks [Approve]
       │     └─► POST /api/v1/drafts/:id/approve
       │     └─► Status: APPROVED, records user_id & approved_at
       │     └─► Updates Discord UI: "✅ Approved by Creator"
       │
       ├─► User clicks [Edit]
       │     └─► Discord modal opens, creator edits text
       │     └─► PATCH /api/v1/drafts/:id
       │     └─► Status reverts to PENDING_APPROVAL (invalidates old approval)
       │
       └─► User clicks [Reject]
             └─► POST /api/v1/drafts/:id/reject
             └─► Status: REJECTED
             └─► Updates Discord UI: "❌ Rejected"
```

---

## Draft State Machine

```text
               ┌──────────┐
               │  DRAFT   │
               └────┬─────┘
                    │ submit
                    ▼
          ┌──────────────────┐
          │ PENDING_APPROVAL │ ◄──────────────┐
          └─────┬───────┬────┘                │
   [Approve]    │       │     [Reject]        │ [Edit] modifies text
   clicked      │       │     clicked         │ (invalidates approval)
                ▼       ▼                     │
         ┌──────────┐ ┌──────────┐            │
         │ APPROVED │ │ REJECTED │            │
         └────┬─────┘ └──────────┘            │
              │                               │
              ├───────────────────────────────┘
              │ Send Task (Phase 6)
              ▼
          ┌────────┐
          │  SENT  │
          └────────┘
```

---

## Atomic Task Breakdown

### Task 5.1: Database Schemas for Drafts and Approvals
- [ ] In `packages/db/src/schema/drafts.ts`, define `drafts` table:
  - `id`: `bigserial` primary key
  - `conversation_id`: `bigint` references `conversations(id)`
  - `agent_run_id`: `bigint` references `agent_runs(id)` nullable
  - `content`: `text` not null
  - `status`: `text` default `'pending_approval'` (`draft`, `pending_approval`, `approved`, `rejected`, `sent`, `failed`, `expired`)
  - `approved_by`: `bigint` references `users(id)` nullable
  - `approved_at`: `timestamp with time zone` nullable
  - `sent_at`: `timestamp with time zone` nullable
  - `created_at`, `updated_at`: `timestamp with time zone` default `now()`
- [ ] In `packages/db/src/schema/approvals.ts`, define `approvals` table:
  - `id`: `bigserial` primary key
  - `draft_id`: `bigint` references `drafts(id)`
  - `user_id`: `bigint` references `users(id)`
  - `action`: `text` (`approve`, `reject`)
  - `status`: `text` (`active`, `revoked`)
  - `created_at`, `updated_at`: `timestamp with time zone` default `now()`
- [ ] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 5.2: Drafts & Approvals Domain Service in `packages/domain`
- [ ] In `packages/domain/src/services/draftService.ts`:
  - `createDraft({ conversationId, content, agentRunId? })`:
    - Creates row with status `pending_approval`.
  - `approveDraft({ draftId, userId })`:
    - Validates draft is in `pending_approval` state.
    - Updates `drafts`: `status = 'approved'`, `approved_by = userId`, `approved_at = now()`.
    - Inserts record into `approvals` table: `action = 'approve'`, `status = 'active'`.
  - `rejectDraft({ draftId, userId, reason? })`:
    - Updates `drafts`: `status = 'rejected'`.
    - Inserts record into `approvals` table: `action = 'reject'`.
  - `updateDraftContent({ draftId, newContent, userId })`:
    - **Crucial Rule:** If `draft.status === 'approved'`, set any active approvals to `revoked`.
    - Set `draft.status = 'pending_approval'`.
    - Set `draft.approved_by = null`, `draft.approved_at = null`.
    - Update `draft.content = newContent`.

---

### Task 5.3: Drafts REST API in `apps/api`
- [ ] In `apps/api/src/routes/drafts.ts`:
  - `GET /api/v1/drafts`:
    - List drafts with pagination, optional filter `?status=pending_approval` or `?conversation_id=...`.
  - `GET /api/v1/drafts/:id`:
    - Return draft details, conversation context, and approval history.
  - `POST /api/v1/drafts`:
    - Manually create a draft (`{ conversationId, content }`).
  - `PATCH /api/v1/drafts/:id`:
    - Edit draft content. Triggers approval revocation if draft was approved.
  - `POST /api/v1/drafts/:id/approve`:
    - Approves draft. Returns HTTP 200 with updated draft.
  - `POST /api/v1/drafts/:id/reject`:
    - Rejects draft. Accepts optional `{ reason }`.
- [ ] Mount routes in `apps/api/src/index.ts`.

---

### Task 5.4: Interactive Discord Approval Buttons & Modals
- [ ] In `packages/discord/src/components/draftButtons.ts`:
  - Create ActionRow with 3 Discord buttons:
    - Button 1: `approve_draft:<draftId>` (Success / Green style, "Approve ✅")
    - Button 2: `edit_draft:<draftId>` (Primary / Blue style, "Edit ✏️")
    - Button 3: `reject_draft:<draftId>` (Danger / Red style, "Reject ❌")
- [ ] Handle Discord Interactions in `packages/discord/src/interactions/`:
  - On `approve_draft:<draftId>` click:
    - Call `approveDraft` domain service / API.
    - Edit Discord original message: replace buttons with confirmation text `"✅ Approved by Creator on [timestamp]"`.
  - On `reject_draft:<draftId>` click:
    - Call `rejectDraft` domain service / API.
    - Edit Discord original message: `"❌ Rejected by Creator"`.
  - On `edit_draft:<draftId>` click:
    - Open Discord Modal (`showModal`) with multiline `TextInput` pre-filled with the current draft text.
    - On modal submission:
      - Call `updateDraftContent` with edited text.
      - Update Discord embed with the new draft text and refresh buttons.

---

## Verification & Testing Steps

1. **State Transition & Invalidation Unit Test:**
   - Create a draft → status is `pending_approval`.
   - Approve draft → status is `approved`, `approved_by` is set.
   - Edit draft content → verify status reverts to `pending_approval`, `approved_by` is cleared, and approval record is marked `revoked`.

2. **API Flow Verification:**
   ```bash
   # 1. Create draft
   DRAFT_ID=$(curl -s -X POST http://localhost:3001/api/v1/drafts \
     -H "Content-Type: application/json" \
     -d '{"conversationId":1,"content":"Initial draft"}' | jq .draft.id)

   # 2. Approve draft
   curl -s -X POST http://localhost:3001/api/v1/drafts/$DRAFT_ID/approve | jq .draft.status
   # Expect: "approved"

   # 3. Edit draft
   curl -s -X PATCH http://localhost:3001/api/v1/drafts/$DRAFT_ID \
     -H "Content-Type: application/json" \
     -d '{"content":"Edited draft"}' | jq .draft.status
   # Expect: "pending_approval"
   ```

3. **Discord UI Verification:**
   - Trigger a draft generation via `/reply`.
   - Confirm embed displays the 3 buttons in the Discord channel.
   - Click [Approve] → confirm status updates instantly.
   - Click [Edit] on another draft → confirm modal appears, submission updates the message.

---

## Done When Checklist
- [ ] Database stores `drafts` and `approvals` with audit timestamps.
- [ ] Draft state machine strictly blocks unapproved drafts from external sending.
- [ ] Editing any draft immediately invalidates prior approvals.
- [ ] Discord embeds feature responsive [Approve], [Edit], and [Reject] controls.
- [ ] Discord modal allows direct editing of draft text without opening the web dashboard.
