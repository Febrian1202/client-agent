# Phase 1 — Event Pipeline: Step-by-Step Implementation Guide

> **Goal:** Build the end-to-end inbound event pipeline: Gmail notification → parsed VGen event → PostgreSQL storage with deduplication → Redis Stream task → Bun Worker → Discord notification.
> **Constraint:** Zero AI and zero browser automation in this phase.
> **Prerequisites:** Phase 0 completed and verified.

---

## Architecture Context for This Phase

```text
VGen Email Notification
       │
       ▼
   Gmail Inbox
       │
       ▼
Google Cloud Pub/Sub
       │ Push Notification
       ▼
Elysia Webhook (/api/v1/webhooks/google/gmail)
       │ 1. Validate Pub/Sub payload
       │ 2. Fetch email via Gmail API
       │ 3. Parse VGen event (subject & sender)
       │ 4. Insert into 'events' (dedup via external_id)
       │ 5. Create task & push to Redis Stream
       ▼
  Redis Stream (client-agent:events)
       │
       ▼
   Bun Worker
       │ 1. Consume PROCESS_GMAIL_EVENT
       │ 2. Find or create client in 'clients' table
       │ 3. Dispatch NOTIFY_DISCORD task
       │ 4. Discord Bot sends notification message
       ▼
Creator's Discord Channel
```

---

## Atomic Task Breakdown

### Task 1.1: Database Schemas for Events, Clients, and Tasks
- [x] In `packages/db/src/schema/events.ts`, define `events` table:
  - `id`: `bigserial` primary key
  - `source`: `text` (e.g. `'gmail'`)
  - `provider`: `text` (e.g. `'vgen'`)
  - `event_type`: `text` (`new_message`, `new_commission`, `commission_confirmed`, etc.)
  - `external_id`: `text` unique (Gmail message ID)
  - `payload`: `jsonb` (raw event / headers / parsed details)
  - `status`: `text` (`received`, `processed`, `failed`)
  - `received_at`, `processed_at`: `timestamp with time zone`
  - `created_at`, `updated_at`: `timestamp with time zone` default `now()`
- [x] In `packages/db/src/schema/clients.ts`, define `clients` table:
  - `id`: `bigserial` primary key
  - `user_id`: `bigint` references `users(id)`
  - `platform`: `text` default `'vgen'`
  - `external_id`: `text` nullable
  - `username`: `text` not null
  - `display_name`: `text` nullable
  - `profile_url`: `text` nullable
  - `avatar_url`: `text` nullable
  - `metadata`: `jsonb` default `{}`
  - `first_seen_at`, `last_seen_at`: `timestamp with time zone`
  - `created_at`, `updated_at`: `timestamp with time zone`
  - Unique constraint: `UNIQUE(user_id, platform, username)`
- [x] In `packages/db/src/schema/agent_tasks.ts`, define `agent_tasks` table:
  - `id`: `bigserial` primary key
  - `user_id`: `bigint` references `users(id)`
  - `event_id`: `bigint` references `events(id)` nullable
  - `type`: `text`
  - `status`: `text` (`queued`, `running`, `completed`, `failed`, `dead`)
  - `input`: `jsonb`
  - `output`: `jsonb` nullable
  - `attempts`: `integer` default `0`
  - `max_attempts`: `integer` default `5`
  - `idempotency_key`: `text` nullable
  - `error`: `text` nullable
  - `started_at`, `completed_at`, `created_at`, `updated_at`: `timestamp with time zone`
- [x] In `packages/db/src/schema/integrations.ts`, define `integrations` table:
  - `id`: `bigserial` primary key
  - `user_id`: `bigint` references `users(id)`
  - `provider`: `text` (`gmail`, `discord`)
  - `status`: `text` (`connected`, `disconnected`, `error`)
  - `credentials_encrypted`: `text` nullable
  - `metadata`: `jsonb` default `{}`
  - `created_at`, `updated_at`: `timestamp with time zone`
- [x] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 1.2: `packages/gmail` (Gmail Client & VGen Email Parser)
- [x] Create `packages/gmail/package.json` (name: `@client-agent/gmail`).
- [x] Implement OAuth credential manager (`src/auth.ts`) using Google APIs (`googleapis` or direct REST fetch). *(Built as a single `src/client.ts` together with the message fetcher, per the approved plan.)*
  - Store tokens, refresh tokens, and auto-refresh logic.
- [x] Implement Gmail message fetcher (`src/messages.ts`): *(Built in the same single `src/client.ts`, per the approved plan.)*
  - Function `fetchMessageById(messageId: string): Promise<GmailMessage>`
  - Function `listHistory(startHistoryId: string): Promise<string[]>`
- [x] Implement VGen Parser (`src/parser.ts`):
  - Identify if email sender is VGen (`no-reply@vgen.co` or similar).
  - Parse subject line patterns:
    - `"@(\w+) sent you a new message!"` → `eventType: NEW_MESSAGE`, `clientUsername: match[1]`
    - `"New commission request from @(\w+)"` → `eventType: NEW_COMMISSION`, `clientUsername: match[1]`
    - `"Commission #(\w+) updated"` → `eventType: COMMISSION_UPDATED`
  - Return normalized object:
    ```ts
    export interface VGenParsedEvent {
      source: 'gmail';
      provider: 'vgen';
      eventType: 'NEW_MESSAGE' | 'NEW_COMMISSION' | 'COMMISSION_CONFIRMED' | 'COMMISSION_UPDATED' | 'COMMISSION_COMPLETED';
      externalId: string; // Gmail message ID
      clientUsername?: string;
      subject: string;
      receivedAt: Date;
    }
    ```
- [x] Write unit tests for the parser using mock email subject lines and headers (`bun test packages/gmail`).

---

### Task 1.3: Gmail Webhook Endpoint in `apps/api`
- [x] Create `apps/api/src/routes/webhooks/gmail.ts`:
  - Route: `POST /api/v1/webhooks/google/gmail`
  - Skip session authentication for this route.
  - Verify Google Cloud Pub/Sub message format (`message.data` base64 decoded).
  - Extract `historyId` or fetch the newest unread messages matching VGen query (`from:vgen.co`).
  - For each VGen message:
    1. Parse with `@client-agent/gmail` parser.
    2. Attempt to insert into `events` table with `external_id = messageId`.
    3. If insert fails with unique constraint violation (duplicate), log and ignore (idempotency).
    4. If insert succeeds:
       - Create an `agent_tasks` record with type `PROCESS_GMAIL_EVENT`.
       - Publish task to Redis Stream `client-agent:events`.
  - Return HTTP 200/204 to acknowledge Pub/Sub promptly.
- [x] Mount route in `apps/api/src/index.ts`. *(Mounted in `apps/api/src/app.ts`, per the approved plan.)*

---

### Task 1.4: `packages/discord` (Discord Bot & Notification Dispatcher)
- [x] Create `packages/discord/package.json` (name: `@client-agent/discord`) with `discord.js`.
- [x] Initialize Discord bot client (`src/client.ts`): *(Implemented as a REST notifier with no gateway connection, per the Phase 1 plan.)*
  - Read `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` from config.
  - Connect bot on worker startup or standalone dispatcher.
- [x] Implement notification formatter (`src/notifications.ts`):
  - Function `sendEventNotification(channelId: string, notification: DiscordEventNotification): Promise<{ messageId: string }>`
  - Embed / message format:
    ```text
    🔔 New VGen Message

    Client: @ErianOsamu
    Event: New Message
    Received: 2026-10-16 14:32 UTC

    The notification email does not contain the conversation content.
    ```

---

### Task 1.5: Worker Task Handlers in `apps/worker`
- [x] In `apps/worker/src/handlers/processGmailEvent.ts`:
  - Input: `{ eventId: number }`
  - Fetch event record from `events` table.
  - If event has `clientUsername`:
    - Find or create client in `clients` table:
      `INSERT INTO clients (user_id, platform, username, first_seen_at, last_seen_at) ... ON CONFLICT DO UPDATE ...`
  - Create `agent_tasks` entry of type `NOTIFY_DISCORD`.
  - Enqueue task to Redis Stream `client-agent:notifications`.
  - Mark `events.status = 'processed'`.
- [x] In `apps/worker/src/handlers/notifyDiscord.ts`:
  - Consume from `client-agent:notifications`.
  - Call `@client-agent/discord` to deliver message to configured creator channel.
  - Mark task as `completed` with timestamp.
- [x] Register both stream consumers in worker initialization loop.

---

### Task 1.6: Integration Management API
- [x] In `apps/api/src/routes/integrations.ts`:
  - `GET /api/v1/integrations` — Return connection status of Gmail and Discord.
  - `POST /api/v1/integrations/gmail` — Save or initiate Gmail OAuth credentials.
  - `DELETE /api/v1/integrations/gmail` — Clear Gmail credentials.
  - `POST /api/v1/integrations/discord` — Test or save Discord channel settings.

---

## Verification & Testing Steps

1. **Unit Test Email Parser:**
   ```bash
   bun test packages/gmail
   ```
   Ensure subjects like `@Alice sent you a new message!` parse to `NEW_MESSAGE` with `username: "Alice"`.

2. **Simulate Webhook Ingestion (Idempotency Test):**
   Send a synthetic Pub/Sub POST request to `/api/v1/webhooks/google/gmail`:
   ```bash
   curl -i -X POST http://localhost:3001/api/v1/webhooks/google/gmail \
     -H "Content-Type: application/json" \
     -d '{"message":{"data":"...base64 encoded..."}}'
   ```
   - Check `events` table: 1 row created.
   - Send the **exact same** request again.
   - Check `events` table: still 1 row, no duplicate created, API returned 200/204 without error.

3. **Verify Worker & Discord Notification:**
   - Watch `apps/worker` logs.
   - Verify task `PROCESS_GMAIL_EVENT` transitions from `queued` → `running` → `completed`.
   - Verify task `NOTIFY_DISCORD` runs and Discord bot posts the plain-text notification in the creator's Discord channel.

---

## Done When Checklist
- [x] Database schema includes `events`, `clients`, `agent_tasks`, and `integrations` with migrations executed.
- [x] VGen email parser correctly parses subject patterns and handles edge cases without throwing.
- [x] Duplicate Gmail message IDs produce zero duplicate database records and zero duplicate notifications.
- [x] Client record is automatically created or updated with `last_seen_at`.
- [x] Discord bot delivers a plain-text notification for every new incoming message notification.
- [x] Integration status endpoint accurately reports whether Gmail and Discord are configured.
