# AGENTS.md — Repository Guide for AI Coding Agents

> **Project:** ClientAgent  
> **Type:** Personal AI Client Management Agent for VGen Creators  
> **Runtime / Monorepo:** Bun Workspaces + TypeScript  
> **Target Deployment:** Dokploy on VPS via Docker Compose  

---

## 1. What This Repository Is

ClientAgent is a personal automation and AI assistant built for a solo creator who sells commissions on VGen. It connects VGen email notifications (via Gmail API + Pub/Sub), Discord (primary control and notification channel), and a SvelteKit web dashboard to:
1. Detect incoming client inquiries and commission events immediately.
2. Retrieve and sync VGen conversations via Playwright browser automation (session reuse).
3. Summarize conversations and draft contextual replies with an LLM.
4. Enforce strict human approval before any external message is sent.
5. Safely send approved replies through VGen under the creator's identity.

This is a **single-user personal tool**, not a multi-tenant SaaS. Keep solutions focused, lean, and reliable.

### Current Implementation Status
- **Phase 0 (Foundation):** COMPLETED (Monorepo, Bun workspaces, Elysia, SvelteKit, Drizzle, Redis, Docker).
- **Phase 1 (Event Pipeline):** COMPLETED (Gmail Pub/Sub → VGen parser → PostgreSQL dedup → Redis Streams → Bun Worker → Discord REST notifications).
- **Phase 2 (Worker Hardening):** COMPLETED (Task state machine, backoff retries, dead-letter recovery, graceful shutdown, task REST APIs).
- **Phase 3 (VGen Reader):** COMPLETED (Playwright session reuse, PlatformAdapter, VGen reader, `/read` command).
- **Phase 4 – 8:** Next up: Phase 4 (AI Agent).

---

## 2. Inviolable Core Constraints & Anti-Goals

Every agent working in this codebase **must** adhere to these rules without exception:

1. **Human-in-the-Loop for External Writes:**
   - The agent MUST NEVER send a message on VGen or any external platform without explicit human approval.
   - An unapproved draft cannot be dispatched (`POST /drafts/:id/send` must return HTTP 409).
   - If a draft is edited after approval, the approval is immediately revoked (`status` reverts to `pending_approval`).

2. **The 7-Point Safety Gate Before Any Send:**
   Before executing a VGen send action, all 7 checks must pass:
   - Correct target conversation?
   - Correct target client?
   - Correct authenticated creator account in browser?
   - Is draft approved?
   - Has draft content changed since approval?
   - Is approval still valid/active?
   - Is conversation state fresh (no unread inbound messages sent after the draft)?
   *If ANY check fails: abort immediately and log an alert.*

3. **No Password Storage & No Anti-Bot Bypassing:**
   - NEVER store the VGen password in code, DB, or environment.
   - NEVER attempt to bypass CAPTCHA, 2FA, cloudflare challenges, or anti-bot mechanisms.
   - The creator logs in manually once in a dedicated browser profile directory (`BROWSER_PROFILE_PATH`). Playwright reuses this persistent context.
   - If session expires, pause the task and alert the creator via Discord.

4. **Queue-First Architecture:**
   - Long-running operations (Playwright navigation, LLM API calls, Gmail synchronization) MUST NEVER run inside Elysia HTTP request handlers.
   - HTTP routes must only validate, persist to DB, push a task to Redis Streams, and return HTTP 200/202 immediately.
   - Background tasks are executed exclusively by `apps/worker`.

5. **Strict Deduplication & Idempotency:**
   - Duplicate webhook signals or Gmail events MUST NEVER produce duplicate database records or multiple notifications.
   - `events.external_id` (Gmail message ID) is unique.
   - Check `idempotency_key` on tasks before execution.

6. **Factuality & Grounding:**
   - The AI agent must NEVER hallucinate or fabricate conversation history, message content, or commission dates.
   - Distinguish memory types: `FACT` (verified), `PREFERENCE` (observed pattern), `INFERENCE` (hypothesis). Inferences must never be stated as established facts.
   - If target client or intent is ambiguous, classify as `LOW_CONFIDENCE` and ask the creator for clarification.

---

## 3. Technology Stack & Directory Structure

| Layer | Technology | Location |
|-------|------------|----------|
| **Runtime & Workspaces** | Bun (`bun`, `bun test`, `bun run`) | Root `package.json`, `bunfig.toml` |
| **Backend API** | Elysia + TypeBox schemas | `apps/api` |
| **Frontend Dashboard** | SvelteKit + Tailwind + shadcn-svelte + Lucide | `apps/web` |
| **Background Worker** | Bun standalone process | `apps/worker` |
| **Database & ORM** | PostgreSQL + Drizzle ORM + `postgres.js` | `packages/db` |
| **Queue / Events** | Redis Streams | `packages/queue` |
| **Domain Types** | Pure TypeScript interfaces & enums | `packages/domain` |
| **Config & Env** | Schema-validated env loader | `packages/config` |
| **Shared Helpers** | Password hashing, ID generation, utils | `packages/shared` |
| **Browser Automation** | Playwright with persistent context | `packages/browser`, `packages/vgen` |
| **Platform Adapter** | `PlatformAdapter` interface contract | `packages/platform` |
| **Integrations** | Gmail API (`packages/gmail`), Discord Bot (`packages/discord`) | `packages/*` |
| **AI / Agent** | Provider abstraction & explicit tool registry | `packages/ai`, `packages/agent` |
| **Infrastructure** | Docker Compose (dev vs. prod) | `infrastructure/` |

---

## 4. Documentation Index

Before implementing any feature, read the relevant specification in `docs/`:

- **Product & Requirements:**
  - `docs/PRODUCT.md` — Product record, audience, problem statement, creator context.
  - `docs/DESIGN.md` — Intent, goals, non-goals, anti-goals, daily flow.
- **Architecture & System Design:**
  - `docs/ARCHITECTURE.md` — Monorepo design, app roles, queue-first data flows, security.
  - `docs/DATA_MODEL.md` — PostgreSQL tables, columns, relations, ERD, idempotency strategy.
  - `docs/API.md` — Complete REST API endpoints, schemas, authentication, and error codes.
  - `docs/adr/` — 12 Architecture Decision Records explaining why each choice was made.
- **Implementation Guides (Step-by-Step):**
  - `docs/PHASES.md` — Phase overview & roadmap checklist.
  - `docs/phase/phase-0-foundation.md` — **[COMPLETED]** Monorepo, Bun workspaces, Elysia, SvelteKit, Drizzle, Redis, Docker.
  - `docs/phase/phase-1-event-pipeline.md` — **[COMPLETED]** Gmail Pub/Sub → parser → deduplication → Discord notification.
  - `docs/phase/phase-2-worker-hardening.md` — **[COMPLETED]** State machine, backoff retries, dead-letter recovery, graceful shutdown.
  - `docs/phase/phase-3-vgen-reader.md` — **[COMPLETED]** Playwright session reuse, PlatformAdapter, VGen reader, `/read` command.
  - `docs/phase/phase-4-ai-agent.md` — **[NEXT UP]** LLM abstraction, tool calling, prompt layers, summarization, `/summarize` & `/reply`.
  - `docs/phase/phase-5-approval-system.md` — Draft state machine, approval invalidation, Discord interactive buttons.
  - `docs/phase/phase-6-vgen-send.md` — VGen sending automation, 7-point safety gate, post-send verification, audit logs.
  - `docs/phase/phase-7-dashboard.md` — SvelteKit web dashboard UI for tasks, conversations, drafts, clients, logs.
  - `docs/phase/phase-8-client-memory.md` — Persistent client context (`FACT`, `PREFERENCE`, `INFERENCE`).

---

## 5. Development Conventions & Commands

### Running Locally
```bash
# 1. Start local PostgreSQL and Redis (Dev Compose)
docker compose -f infrastructure/docker-compose.yml up -d postgres redis

# 2. Run Database Migrations
bun run --filter=@client-agent/db db:migrate

# 3. Start all applications concurrently
bun dev

# Or start specific applications individually
bun --filter=@client-agent/api dev      # Elysia API on http://localhost:3001
bun --filter=@client-agent/web dev      # SvelteKit Dashboard on http://localhost:5173
bun --filter=@client-agent/worker dev   # Background Worker process
```

### Testing & Code Quality
```bash
# Run all unit tests across workspaces
bun test

# Run tests for specific packages or apps
bun test packages/gmail
bun test packages/discord
bun test packages/db
bun test packages/queue
bun test apps/api
bun test apps/worker

# Run end-to-end integration tests
bun test tests/e2e-event-pipeline.test.ts
bun test tests/e2e-worker-hardening.test.ts

# Typecheck all packages
bun run typecheck
```

### Docker Strategy (ADR-012)
- **Development (`infrastructure/docker-compose.yml`):** Includes `postgres` and `redis` containers for local convenience.
- **Production (`infrastructure/docker-compose.prod.yml`):** Used by **Dokploy** on the VPS. Does **NOT** include Postgres or Redis containers because they are already hosted on the VPS. Only packages `api`, `web`, and `worker`.

---

## 6. Guidelines for AI Agents Working on This Codebase

When executing tasks or implementing phases:
1. **Always read the corresponding `docs/phase/phase-X-...md` first.** Follow the atomic tasks in order.
2. **Never skip or combine phases.** Follow the dependency order: Phase 0 → Phase 1 → Phase 2 ...
3. **Verify every step:** Write tests, run verification commands, check database tables, and confirm expected behavior before claiming a task or phase is complete.
4. **Preserve types and contracts:** Keep `@client-agent/domain` pure and decoupled from framework dependencies.
5. **No AI slop in code comments:** Write clean, self-documenting TypeScript. Avoid redundant comments explaining what standard code does.
6. **Keep audit logs immutable:** The `audit_logs` table must never be updated or deleted. Every critical state change must produce an audit record.
