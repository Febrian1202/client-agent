# Phase 6 — VGen Send: Step-by-Step Implementation Guide

> **Goal:** Safely send approved drafts to VGen using Playwright browser automation, protected by the mandatory 7-point safety gate, post-send verification, non-destructive retry handling, and immutable audit logging.
> **Strict Anti-Goal:** Blindly retrying message sends after a network glitch or timeout. If send result is ambiguous, the worker MUST inspect the conversation before taking any action.
> **Prerequisites:** Phase 5 completed.

---

## Architecture Context for This Phase

```text
User / API approves send
       │
       ▼
POST /api/v1/drafts/:id/send
       │ 1. Verify draft.status === 'approved'
       │ 2. Create SEND_VGEN_MESSAGE task
       ▼
Redis Stream (client-agent:send)
       │
       ▼
Bun Worker
       │
       ▼
═══════ THE 7-POINT SAFETY GATE ═══════
 1. Correct target conversation?
 2. Correct target client?
 3. Correct authenticated VGen account?
 4. Is the draft approved?
 5. Has the draft changed since approval?
 6. Is the approval still valid?
 7. Is action still valid in current conversation state?
═══════════════════════════════════════
       │ Any check fails? ──► ABORT & Log Security Alert
       ▼ All checks pass
Execute Send via VGenBrowserAdapter (Playwright)
       │
       ▼
Post-Send Verification:
  - Wait for message bubble to appear in DOM
  - Check message text matches draft content
       │
       ├─► Verified?
       │     ├─► Insert outbound record into 'messages' table
       │     ├─► Update draft.status = 'sent', sent_at = now()
       │     ├─► Insert immutable entry in 'audit_logs'
       │     └─► Send confirmation to Discord channel
       │
       └─► Ambiguous / Timeout?
             ├─► DO NOT RETRY BLINDLY!
             ├─► Re-fetch conversation messages
             └─► If message exists: treat as sent; else: pause and alert creator
```

---

## Atomic Task Breakdown

### Task 6.1: Database Schema for `audit_logs`
- [ ] In `packages/db/src/schema/audit_logs.ts`, define `audit_logs` table:
  - `id`: `bigserial` primary key
  - `user_id`: `bigint` references `users(id)` nullable
  - `actor_type`: `text` not null (`user`, `agent`, `system`)
  - `actor_id`: `bigint` nullable
  - `action`: `text` not null (`USER_APPROVED_DRAFT`, `AGENT_ATTEMPTED_SEND`, `MESSAGE_SENT`, `MESSAGE_SEND_FAILED`, etc.)
  - `target_type`: `text` not null (`draft`, `message`, `conversation`)
  - `target_id`: `bigint` not null
  - `metadata`: `jsonb` default `{}`
  - `ip_address`: `text` nullable
  - `created_at`: `timestamp with time zone` default `now()` **(Immutable — NO updated_at column)**
- [ ] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 6.2: Implement the 7-Point Safety Gate
- [ ] In `packages/domain/src/safety/safetyGate.ts`:
  - Provide function `verifyPreSendConditions(params: PreSendCheckParams): Promise<SafetyCheckResult>`
  - Run the 7 checks in sequence:
    1. **Target Conversation Exists:** Verify conversation ID is in the database and matches platform `vgen`.
    2. **Target Client Exists:** Verify conversation belongs to the expected client username.
    3. **Authenticated Account Match:** Verify active VGen browser profile matches the creator's username (check profile header in DOM).
    4. **Status Check:** Verify `draft.status === 'approved'`.
    5. **Content Unchanged:** Verify hash of current draft content matches hash recorded at approval time.
    6. **Approval Validity:** Verify there is an active `approvals` record with `status = 'active'` for this draft.
    7. **State Freshness:** Check that the client has not sent another message after the draft was generated that makes the draft stale.
  - If any check fails, return `{ allowed: false, reason: string }`.

---

### Task 6.3: VGen Browser Adapter Send & Verification in `packages/vgen`
- [ ] In `packages/vgen/src/send.ts`:
  - Implement `sendMessage({ conversationUrl, content }): Promise<{ success: boolean; messageId: string }>`:
    1. Navigate to conversation URL.
    2. Locate textarea input element (`[data-testid="message-input"]` or equivalent).
    3. Type draft text cleanly without tripping anti-bot triggers (natural delay between keystrokes if needed).
    4. Click Send button or press Enter.
    5. **Post-Send Verification:**
       - Wait for network idle and wait for new message bubble to appear in DOM.
       - Verify the text of the newest message bubble equals `content`.
       - Extract message timestamp or DOM element ID.
- [ ] Implement Ambiguous Failure Recovery:
  - If network disconnects or times out before confirmation:
    - Reload conversation page.
    - Inspect last 3 messages in DOM.
    - If the draft text is present: return success.
    - If the draft text is absent: throw `SendAmbiguousError` (do not resend automatically).

---

### Task 6.4: Worker Task Handler: `SEND_VGEN_MESSAGE`
- [ ] In `apps/worker/src/handlers/sendVgenMessage.ts`:
  - Input: `{ draftId: number, userId: number }`
  - Step 1: Execute `verifyPreSendConditions`. If failed:
    - Log audit entry: `MESSAGE_SEND_ABORTED_SAFETY_CHECK`.
    - Mark task dead, notify Discord: `"🛑 Safety check blocked send: [reason]"`.
    - Return early.
  - Step 2: Log audit entry: `AGENT_ATTEMPTED_SEND`.
  - Step 3: Call `vgenAdapter.sendMessage(...)`.
  - Step 4: On success:
    - Insert into `messages`: `direction: 'outbound'`, `sender_type: 'creator'`, `content: draft.content`, `sent_at: now()`.
    - Update `drafts`: `status = 'sent'`, `sent_at = now()`.
    - Log audit entry: `MESSAGE_SENT`.
    - Send Discord confirmation: `"🚀 Message successfully delivered to @[ClientName] on VGen!"`.

---

### Task 6.5: Send Trigger API Endpoint in `apps/api`
- [ ] In `apps/api/src/routes/drafts.ts`:
  - `POST /api/v1/drafts/:id/send`
  - Fetch draft. If `status !== 'approved'`, return HTTP 409 Conflict `{ error: { code: "NOT_APPROVED", message: "Draft must be approved before sending" } }`.
  - Create `agent_tasks` record with type `SEND_VGEN_MESSAGE`.
  - Publish task to Redis Stream `client-agent:send`.
  - Return HTTP 202 Accepted `{ taskId, status: "queued" }`.

---

## Verification & Testing Steps

1. **Safety Gate Negative Tests:**
   - Attempt to call `POST /drafts/:id/send` on a draft with status `pending_approval` → verify HTTP 409.
   - Manually tamper with draft content after approval → verify safety gate aborts before launching Playwright.
   - Verify `audit_logs` records the security abort.

2. **End-to-End Send Test (Controlled Staging/Test Account):**
   - Create a test conversation with a test client account on VGen.
   - Generate draft → Approve via Discord or API → Trigger send.
   - Verify worker logs:
     - Safety checks: 7/7 PASSED.
     - Navigation & typing.
     - Post-send verification: message confirmed in DOM.
     - Database updated: `drafts.status = 'sent'`, `messages` has outbound row, `audit_logs` has `MESSAGE_SENT`.
   - Verify Discord displays success confirmation.

3. **Ambiguous Recovery Simulation:**
   - Simulate a network cutoff immediately after clicking send.
   - Verify worker does NOT submit a duplicate message, but instead inspects the thread DOM.

---

## Done When Checklist
- [ ] `audit_logs` table is created and strictly immutable.
- [ ] All 7 safety checks execute before any browser interaction occurs.
- [ ] Unapproved or tampered drafts cannot be sent under any circumstances.
- [ ] Post-send verification confirms message existence in VGen DOM before updating database records.
- [ ] Ambiguous failures halt safely without duplicate message delivery.
- [ ] Outbound messages and audit logs are recorded accurately.
- [ ] Discord receives immediate delivery confirmation.
