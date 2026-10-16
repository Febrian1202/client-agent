# ClientAgent — Documentation Index

> All project specifications, architectural decisions, and phase-by-phase implementation guides are organized here.

---

## 1. Product & Architecture Specifications

| File | Purpose |
|------|---------|
| [PRODUCT.md](PRODUCT.md) | Audience, core problem, creator context, non-negotiable constraints, and scale. |
| [DESIGN.md](DESIGN.md) | High-level system goals, non-goals, anti-goals, daily flow, and key decisions. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Monorepo layout, app responsibilities, queue-first design, data flows, and security model. |
| [DATA_MODEL.md](DATA_MODEL.md) | All PostgreSQL tables, types, constraints, ERD, and deduplication/idempotency rules. |
| [API.md](API.md) | Complete REST API specification for `apps/api` (auth, endpoints, schemas, error codes). |
| [PHASES.md](PHASES.md) | High-level roadmap summary across Phase 0 to Phase 9. |
| [ClientAgent_Technical_Blueprint_v0.2.md](ClientAgent_Technical_Blueprint_v0.2.md) | Original comprehensive technical blueprint (reference draft). |

---

## 2. Implementation Phase Guides (`docs/phase/`)

Step-by-step atomic instructions for programmers and AI agents:

| Phase | Guide | Description |
|-------|-------|-------------|
| Phase 0 | [phase/phase-0-foundation.md](phase/phase-0-foundation.md) | Monorepo, Bun workspaces, Elysia API, SvelteKit shell, worker heartbeat, Drizzle + Postgres, Redis, Docker configs. |
| Phase 1 | [phase/phase-1-event-pipeline.md](phase/phase-1-event-pipeline.md) | Inbound event pipeline: Gmail Pub/Sub → VGen parser → PostgreSQL deduplication → Discord notification. *(Zero AI, zero browser).* |
| Phase 2 | [phase/phase-2-worker-hardening.md](phase/phase-2-worker-hardening.md) | Worker state machine, retries with backoff, dead-letter recovery (`XAUTOCLAIM`), graceful shutdown. |
| Phase 3 | [phase/phase-3-vgen-reader.md](phase/phase-3-vgen-reader.md) | Playwright session management, `PlatformAdapter` contract, `VGenBrowserAdapter`, conversation syncing, `/read` command. |
| Phase 4 | [phase/phase-4-ai-agent.md](phase/phase-4-ai-agent.md) | LLM provider abstraction, tool registry, layered prompts, summarization, draft generation, `/summarize` & `/reply` commands. |
| Phase 5 | [phase/phase-5-approval-system.md](phase/phase-5-approval-system.md) | Human-in-the-loop approval workflow, draft state machine, approval invalidation on edits, Discord interactive buttons. |
| Phase 6 | [phase/phase-6-vgen-send.md](phase/phase-6-vgen-send.md) | VGen sending automation, **7-Point Safety Gate**, post-send DOM verification, immutable audit logging. |
| Phase 7 | [phase/phase-7-dashboard.md](phase/phase-7-dashboard.md) | SvelteKit dashboard (Tailwind + shadcn-svelte + Lucide) for tasks, conversations, drafts, clients, commissions, and audit logs. |
| Phase 8 | [phase/phase-8-client-memory.md](phase/phase-8-client-memory.md) | Long-term memory store (`FACT`, `PREFERENCE`, `INFERENCE`), prompt context injection, client notes UI. |

---

## 3. Architecture Decision Records (`docs/adr/`)

| ADR | Title | Decision Summary |
|-----|-------|------------------|
| [001](adr/001-full-typescript.md) | Full TypeScript Stack | Single language across frontend, backend, workers, and tools. |
| [002](adr/002-bun-runtime.md) | Bun Runtime | Single fast runtime and package manager for monorepo and execution. |
| [003](adr/003-sveltekit-frontend.md) | SvelteKit Frontend | Lightweight, type-safe UI framework with Tailwind + shadcn-svelte + Lucide. |
| [004](adr/004-elysia-backend.md) | Elysia Backend | Typed, lightweight HTTP API framework running natively on Bun. |
| [005](adr/005-queue-first.md) | Queue-First Backend | Long-running operations execute in background workers via Redis Streams. |
| [006](adr/006-redis-streams.md) | Redis Streams for Queue | Built-in stream persistence and consumer groups without heavy queue dependencies. |
| [007](adr/007-gmail-pubsub.md) | Gmail API + Pub/Sub | Push-based event triggering for inbound notification detection. |
| [008](adr/008-browser-automation-vgen.md) | Browser Automation for VGen | Fallback integration with dedicated profile; never bypass security/CAPTCHA. |
| [009](adr/009-human-approval.md) | Human Approval for External Writes | Mandatory human sign-off before sending any external message. |
| [010](adr/010-platform-adapters.md) | Platform Adapter Pattern | Core domain decoupled from platform-specific integration details. |
| [011](adr/011-single-user-auth.md) | Single-User Authentication | Username + password hash in env, session stored in Redis. |
| [012](adr/012-docker-compose-strategy.md) | Docker Compose Strategy | Dev compose includes Postgres+Redis; prod compose runs apps only (Dokploy). |
