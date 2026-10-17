# Phase 3 — VGen Reader: Step-by-Step Implementation Guide

> **Goal:** Safely retrieve and persist VGen conversation threads and messages using Playwright browser automation with a dedicated authenticated profile, behind a clean `PlatformAdapter` interface.
> **Strict Constraints:**
> - NEVER store VGen passwords in code, database, or environment.
> - NEVER attempt to bypass CAPTCHA, 2FA, or anti-bot defenses.
> - Authentication is done manually by the creator once in a dedicated browser profile.
> **Prerequisites:** Phase 2 completed.

---

## Architecture Context for This Phase

```text
Discord Command: /read <username>
       │
       ▼
Elysia API (POST /api/v1/agent/run or /conversations/:id/sync)
       │ Creates READ_VGEN_CONVERSATION task
       ▼
Redis Stream (client-agent:browser)
       │
       ▼
Bun Worker
       │
       ▼
packages/platform (PlatformAdapter Interface)
       │
       ▼
packages/vgen (VGenBrowserAdapter)
       │
       ▼
packages/browser (Playwright + BROWSER_PROFILE_PATH)
       │ Checks session validity:
       │  ├─ Expired? ──► Pause task, notify creator via Discord
       │  └─ Valid?   ──► Navigate to client conversation, extract DOM messages
       ▼
PostgreSQL
  - Store conversation record in 'conversations'
  - Store messages in 'messages' (deduplicated by external_id)
       │
       ▼
Discord Bot sends summary of retrieved conversation to creator
```

---

## Atomic Task Breakdown

### Task 3.1: Database Schemas for Conversations and Messages
- [x] In `packages/db/src/schema/conversations.ts`, define `conversations` table:
  - `id`: `bigserial` primary key
  - `client_id`: `bigint` references `clients(id)`
  - `platform`: `text` default `'vgen'`
  - `external_id`: `text` (VGen conversation thread ID / URL slug)
  - `external_url`: `text` nullable
  - `status`: `text` default `'active'` (`active`, `archived`)
  - `last_synced_at`: `timestamp with time zone`
  - `created_at`, `updated_at`: `timestamp with time zone`
  - Unique constraint: `UNIQUE(platform, external_id)`
- [x] In `packages/db/src/schema/messages.ts`, define `messages` table:
  - `id`: `bigserial` primary key
  - `conversation_id`: `bigint` references `conversations(id)`
  - `external_id`: `text` nullable (VGen message identifier or deterministic hash)
  - `direction`: `text` (`inbound`, `outbound`)
  - `sender_type`: `text` (`client`, `creator`, `agent`)
  - `sender_name`: `text`
  - `content`: `text`
  - `metadata`: `jsonb` default `{}`
  - `sent_at`: `timestamp with time zone`
  - `created_at`, `updated_at`: `timestamp with time zone`
  - Unique constraint: `UNIQUE(conversation_id, external_id)`
- [x] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 3.2: `packages/browser` (Playwright Session Manager)
- [x] Create `packages/browser/package.json` (name: `@client-agent/browser`) with `playwright`.
- [x] Implement Browser Context Manager (`src/context.ts`):
  - Read `BROWSER_PROFILE_PATH` from `@client-agent/config`.
  - Provide helper `launchPersistentContext()`:
    - Launches Chromium using `chromium.launchPersistentContext(profilePath, { headless: true, ... })`.
    - Configures standard user agent and viewport.
- [x] Implement Session Expiry Checker (`src/session.ts`):
  - Function `checkVGenAuthStatus(page: Page): Promise<boolean>`
  - Navigates to `https://vgen.co/dashboard` or messages URL.
  - If redirected to `/login` or auth prompts are visible, returns `false`.
  - If authenticated user avatar/dashboard is present, returns `true`.

---

### Task 3.3: `packages/platform` (Platform Adapter Contract)
- [x] Create `packages/domain/src/platform.ts` or `packages/platform/package.json` (name: `@client-agent/platform`):
  - Define core contracts:
    ```ts
    export interface FindClientInput { username: string; }
    export interface ClientResult { id: string; username: string; displayName?: string; }

    export interface GetConversationInput { clientUsername: string; limit?: number; }
    export interface ConversationResult {
      externalId: string;
      externalUrl: string;
      messages: MessageResult[];
    }

    export interface MessageResult {
      externalId: string;
      direction: 'inbound' | 'outbound';
      senderName: string;
      content: string;
      sentAt: Date;
    }

    export interface PlatformAdapter {
      findClient(input: FindClientInput): Promise<ClientResult>;
      getConversation(input: GetConversationInput): Promise<ConversationResult>;
      getMessages(input: { conversationId: string; limit?: number }): Promise<MessageResult[]>;
      sendMessage(input: { conversationId: string; content: string }): Promise<{ success: boolean; messageId: string }>;
    }
    ```

---

### Task 3.4: `packages/vgen` (VGen Browser Adapter Implementation)
- [x] Create `packages/vgen/package.json` (name: `@client-agent/vgen`).
- [x] Implement `VGenBrowserAdapter` implementing `PlatformAdapter`:
  - `getConversation({ clientUsername, limit = 20 })`:
    1. Acquire page from persistent context.
    2. Check auth status. If invalid, throw `SessionExpiredError`.
    3. Navigate to VGen inbox / search for `clientUsername`.
    4. Open the conversation thread matching the username.
    5. Extract thread external ID from URL.
    6. Scrape recent messages from DOM (sender, text, timestamp).
    7. Return normalized `ConversationResult`.
- [x] Provide clear error types: `ClientNotFoundError`, `SessionExpiredError`, `NavigationTimeoutError`.

---

### Task 3.5: Worker Task Handler: `READ_VGEN_CONVERSATION`
- [x] In `apps/worker/src/handlers/readVgenConversation.ts`:
  - Input: `{ clientUsername: string, requestedBy: 'discord' | 'web' }`
  - Call `vgenAdapter.getConversation({ clientUsername })`.
  - Handle `SessionExpiredError`:
    - Pause task.
    - Dispatch Discord alert: `⚠️ VGen session has expired! Please log in via browser profile to resume automation.`
    - Mark task failed (non-retriable until re-auth).
  - On success:
    - Upsert conversation in PostgreSQL `conversations` table.
    - Upsert messages in `messages` table with `ON CONFLICT (conversation_id, external_id) DO NOTHING`.
    - Update `conversations.last_synced_at = now()`.
    - If triggered by Discord: format and send recent messages preview to Discord channel.

---

### Task 3.6: Discord Command: `/read <username>`
- [x] In `packages/discord/src/commands/read.ts`:
  - Register slash command `/read <username>` in Discord application.
  - On interaction:
    - Respond immediately with deferred reply: `"Fetching conversation for @" + username + "... ⏳"`.
    - Send API request to Elysia or enqueue `READ_VGEN_CONVERSATION` task.
    - Listen for task completion or worker callback.
    - Edit Discord reply with the latest 5 messages, formatted cleanly with sender names and timestamps.

---

## Verification & Testing Steps

1. **Initial Profile Authentication (Manual):**
   - Run a one-time helper script to launch non-headless Chromium in `BROWSER_PROFILE_PATH`:
     ```bash
     bun run scripts/setup-browser-session.ts
     ```
   - Manually log into your VGen account in the opened window.
   - Close the browser. Verify cookies/session persist in the profile directory.

2. **Session Check Test:**
   - Execute unit test verifying `checkVGenAuthStatus()` returns `true` on the authenticated profile.

3. **Read Conversation Test:**
   - Trigger task via Discord slash command `/read <KnownClientUsername>` or via API:
     ```bash
     curl -X POST http://localhost:3001/api/v1/agent/run \
       -H "Content-Type: application/json" \
       -d '{"message":"read <KnownClientUsername>"}'
     ```
   - Verify worker logs: navigation, DOM parsing, message extraction.
   - Inspect PostgreSQL `conversations` and `messages` tables: verify rows are created.
   - Check Discord: confirm message preview embed appears with correct text.

4. **Expired Session Simulation:**
   - Test behavior when pointing to an unauthenticated profile path:
   - Ensure worker catches `SessionExpiredError` and posts a Discord warning instead of crashing.

---

## Done When Checklist
- [x] `packages/platform` cleanly decouples domain logic from browser automation details.
- [x] `packages/vgen` retrieves real conversation messages for a specified client username.
- [x] Retrieved messages are saved to PostgreSQL without duplicates on repeated reads.
- [x] Session expiry is reliably detected, triggers an alert, and pauses gracefully.
- [x] Discord `/read <username>` command returns the latest messages directly in the channel.
