# ClientAgent — Implementation Phases

> **Date:** 2026-10-16

---

## Guiding Principle

Do not start with the autonomous agent. Build the reliable event
pipeline first, then layer on capabilities. Each phase produces a
working system that does something useful.

---

## Phase 0 — Foundation

> **Detailed Guide:** See [docs/phase/phase-0-foundation.md](phase/phase-0-foundation.md)

**Goal:** A running monorepo with all infrastructure connected.

```
[x] Bun workspaces monorepo (root package.json, tsconfig)
[x] apps/api — Elysia with health endpoints
[x] apps/web — SvelteKit with Tailwind + shadcn-svelte + Lucide
[x] apps/worker — Bun process with heartbeat loop
[x] packages/db — Drizzle schema (users table), connection, migrations
[x] packages/domain — Base types and enums
[x] packages/queue — Redis Streams publish/consume abstraction
[x] packages/config — Env validation and loading
[x] packages/shared — Shared utilities
[x] Docker Compose (dev) — Postgres + Redis
[x] Docker Compose (prod) — Apps only, no Postgres/Redis
[x] Dockerfiles for api, web, worker
[x] Auth — login/logout/me endpoints, session in Redis
[x] Login page in SvelteKit
[x] Worker consumes a test stream and logs messages
```

**Done when:**

- `docker compose up` starts Postgres + Redis.
- `bun dev` starts all three apps.
- Login works and returns a session cookie.
- `/health` and `/health/ready` respond correctly.
- Worker logs heartbeat messages.
- Worker can consume a message from a Redis Stream.

---

## Phase 1 — Event Pipeline

> **Detailed Guide:** See [docs/phase/phase-1-event-pipeline.md](phase/phase-1-event-pipeline.md)

**Goal:** Gmail notification → parsed event → stored → Discord notification.

```
[ ] packages/gmail — Gmail API client, OAuth flow
[ ] Gmail Pub/Sub webhook endpoint
[ ] VGen email parser (subject line patterns → event types)
[ ] Event model in database
[ ] Event deduplication via external_id uniqueness
[ ] PROCESS_GMAIL_EVENT task type
[ ] packages/discord — Discord bot, notification sending
[ ] Worker handler: process event → send Discord notification
[ ] Integration settings endpoints
```

**Done when:**

- A VGen notification email produces exactly one Discord notification.
- Duplicate emails are silently ignored.
- Events are persisted in the database.
- The creator sees: `🔔 New VGen Message from @ClientName`

---

## Phase 2 — Worker System Hardening

> **Detailed Guide:** See [docs/phase/phase-2-worker-hardening.md](phase/phase-2-worker-hardening.md)

**Goal:** Reliable task processing with retries and failure handling.

```
[ ] Task state machine (queued → running → completed/failed → dead)
[ ] Bounded retries with backoff
[ ] Dead-letter handling
[ ] Idempotency key checking
[ ] Task status API endpoints
[ ] Worker graceful shutdown
[ ] Worker restart without losing tasks
```

**Done when:**

- A failed task retries up to max_attempts, then moves to dead state.
- Restarting the worker does not lose pending tasks.
- Task status is visible via API.

---

## Phase 3 — VGen Reader

> **Detailed Guide:** See [docs/phase/phase-3-vgen-reader.md](phase/phase-3-vgen-reader.md)

**Goal:** Retrieve and store VGen conversations via browser automation.

```
[ ] packages/browser — Playwright utilities, profile management
[ ] packages/platform — PlatformAdapter interface
[ ] packages/vgen — VGenBrowserAdapter implementation
[ ] Browser session management (manual auth, session reuse)
[ ] Session expiry detection and creator notification
[ ] Client model in database
[ ] Conversation and message models in database
[ ] READ_VGEN_CONVERSATION task handler
[ ] SYNC_CONVERSATION task handler
[ ] Discord /read command
```

**Done when:**

- `/read ErianOsamu` in Discord retrieves the conversation from VGen.
- Messages are stored in the database.
- Session expiry pauses the task and notifies the creator.

---

## Phase 4 — AI Agent

> **Detailed Guide:** See [docs/phase/phase-4-ai-agent.md](phase/phase-4-ai-agent.md)

**Goal:** Summarize conversations and generate reply drafts.

```
[ ] packages/ai — LLM provider abstraction
[ ] packages/agent — Agent core, tool registry, context builder
[ ] Prompt architecture (base + safety + context layers)
[ ] summarize_conversation tool
[ ] draft_reply tool
[ ] Agent run recording
[ ] GENERATE_SUMMARY task handler
[ ] GENERATE_REPLY_DRAFT task handler
[ ] Discord /summarize and /reply commands
```

**Done when:**

- `/summarize ErianOsamu` produces an AI summary in Discord.
- `/reply ErianOsamu <instruction>` generates a draft.
- Agent runs are recorded with token usage and timing.

---

## Phase 5 — Approval System

> **Detailed Guide:** See [docs/phase/phase-5-approval-system.md](phase/phase-5-approval-system.md)

**Goal:** Human-in-the-loop approval for reply drafts.

```
[ ] Draft model in database
[ ] Approval model in database
[ ] Draft state machine (draft → pending → approved/rejected)
[ ] Approval invalidation on draft edit
[ ] Draft approval/rejection API endpoints
[ ] Discord draft display with [Approve] [Edit] [Reject] buttons
[ ] Discord approval/rejection interactions
```

**Done when:**

- Drafts appear in Discord with action buttons.
- Approving a draft records the approval.
- Editing an approved draft invalidates the approval.
- Rejected drafts cannot be sent.

---

## Phase 6 — VGen Send

> **Detailed Guide:** See [docs/phase/phase-6-vgen-send.md](phase/phase-6-vgen-send.md)

**Goal:** Send approved messages through VGen.

```
[ ] SEND_VGEN_MESSAGE task handler
[ ] Safety gate (7 pre-send checks)
[ ] Send verification (check message appeared)
[ ] Ambiguous failure handling (no blind retry)
[ ] Outbound message recording
[ ] Audit log for send actions
[ ] Discord confirmation after send
```

**Done when:**

- An approved draft can be sent to VGen.
- The 7 safety checks run before every send.
- Successful sends are verified and logged.
- Ambiguous failures do not retry blindly.
- The creator gets confirmation in Discord.

---

## Phase 7 — SvelteKit Dashboard

> **Detailed Guide:** See [docs/phase/phase-7-dashboard.md](phase/phase-7-dashboard.md)

**Goal:** Visual management interface.

```
[ ] Dashboard overview (counts, recent activity)
[ ] Conversation list and viewer
[ ] Draft viewer/editor with approve/reject
[ ] Client list and detail pages
[ ] Commission viewer
[ ] Agent task status page
[ ] Integration settings page
[ ] Audit log viewer
```

**Priority order:**
1. Dashboard shell + layout
2. Agent task status
3. Conversation viewer
4. Draft viewer/editor
5. Approval UI
6. Clients
7. Commissions
8. Integrations
9. Audit log

**Done when:**

- The dashboard shows a useful overview.
- Conversations can be browsed and read.
- Drafts can be edited and approved from the web UI.

---

## Phase 8 — Client Memory

> **Detailed Guide:** See [docs/phase/phase-8-client-memory.md](phase/phase-8-client-memory.md)

**Goal:** Persistent client context for better AI responses.

```
[ ] Client facts/preferences/notes storage
[ ] Memory classification (fact, preference, inference)
[ ] Context injection into agent prompts
[ ] Memory management UI
```

**Done when:**

- The agent uses client history to produce better drafts.
- The creator can view and edit stored client knowledge.

---

## Phase 9 — Multi-Platform

**Goal:** Additional notification channels and platform adapters.

```
[ ] packages/telegram — Telegram bot adapter
[ ] Additional platform adapters (if needed)
```

---

## Implementation Order Summary

```
Phase 0: Foundation (monorepo, infra, auth, health)
    ↓
Phase 1: Event Pipeline (Gmail → parse → store → Discord)
    ↓
Phase 2: Worker Hardening (retries, idempotency, dead-letter)
    ↓
Phase 3: VGen Reader (Playwright, conversation storage)
    ↓
Phase 4: AI Agent (summarize, draft)
    ↓
Phase 5: Approval System (approve/reject/edit drafts)
    ↓
Phase 6: VGen Send (send approved messages, safety gate)
    ↓
Phase 7: Dashboard (SvelteKit UI)
    ↓
Phase 8: Client Memory (persistent context)
    ↓
Phase 9: Multi-Platform (Telegram, future adapters)
```
