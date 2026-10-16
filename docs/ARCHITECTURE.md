# ClientAgent — Architecture Overview

> **Date:** 2026-10-16

---

## System Overview

```
                               ┌───────────────┐
                               │     VGen      │
                               └───────┬───────┘
                                       │
                              notification email
                                       │
                                       ▼
                               ┌───────────────┐
                               │     Gmail     │
                               └───────┬───────┘
                                       │
                                  Gmail API
                                       │
                                       ▼
                              Google Cloud Pub/Sub
                                       │
                                       ▼
                              ┌──────────────────┐
                              │   Elysia API     │
                              │      Bun         │
                              └────────┬─────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
               PostgreSQL           Redis          Agent Orchestrator
                                     │                  │
                                     ▼                  │
                                Bun Workers             │
                                     │                  │
                          ┌──────────┼───────────┐      │
                          │          │           │      │
                          ▼          ▼           ▼      │
                      Playwright    LLM       Discord   │
                          │                      │      │
                          ▼                      ▼      │
                         VGen                 Creator   │
                                                        │
                              SvelteKit ◄───────────────┘
```

---

## Core Principle: Queue-First

Long-running operations never execute inside HTTP requests. The API's
job is to validate, persist, and enqueue. Workers do the heavy lifting.

```
HTTP request → validate → persist → enqueue → respond immediately
                                        │
                                        ▼
                                    Worker picks up task
                                        │
                                        ▼
                                    Execute (Playwright, LLM, Discord)
                                        │
                                        ▼
                                    Persist result
```

This matters because:

- Playwright page loads take seconds.
- LLM calls take seconds.
- Gmail API calls can be slow.
- HTTP requests should respond in milliseconds.

---

## Applications

### apps/api — Elysia API

The central coordination point. Responsibilities:

- REST endpoints for dashboard and integrations.
- Webhook ingestion (Gmail Pub/Sub, Discord interactions).
- Request validation via TypeBox schemas.
- Authentication (username + password, session in Redis).
- Authorization (single user, but still enforced).
- Task creation and queue publishing.
- Database reads through repository layer.

Does NOT:

- Run Playwright.
- Call LLMs directly.
- Send Discord messages directly (except webhook responses).
- Execute long-running operations.

### apps/web — SvelteKit Dashboard

The visual interface. Responsibilities:

- Dashboard overview (counts, recent activity).
- Conversation viewer.
- Draft editor with approve/reject actions.
- Client list and detail views.
- Commission viewer.
- Agent task status.
- Integration settings.
- Audit log viewer.
- Login page.

Built with Tailwind CSS, shadcn-svelte components, Lucide icons.

Calls the Elysia API for all data. Contains no business logic.

### apps/worker — Bun Worker

Background task processor. Responsibilities:

- Consume tasks from Redis Streams.
- Run Playwright for VGen interaction.
- Call LLM APIs for summaries and drafts.
- Send Discord notifications.
- Synchronize conversation data.
- Execute approved message sends.
- Record task results and failures.

Workers must be independently restartable without losing tasks (Redis
Streams provides this via consumer groups and acknowledgment).

---

## Packages

### packages/db

Drizzle schema definitions, migrations, and repository functions.
Contains all database access. Other packages import from here to
read/write data.

### packages/domain

Domain entities, enums, and contracts. Pure TypeScript types and
interfaces — no runtime dependencies. This is the shared vocabulary
of the system.

### packages/queue

Redis Streams abstraction. Provides:

- Stream publishing (add task to stream).
- Consumer group management.
- Task consumption with acknowledgment.
- Dead-letter handling.

### packages/config

Environment variable loading and validation. Single source of truth for
all configuration. Uses a schema to validate that required variables
exist at startup.

### packages/shared

Shared utilities, validation schemas, and helper functions used across
multiple packages. Things that don't belong to a specific domain.

### packages/agent (later)

Agent orchestration, tool registry, context builder. Added when AI
features are implemented.

### packages/ai (later)

LLM provider abstraction. Added when AI features are implemented.

### packages/platform (later)

PlatformAdapter interface. Added when VGen integration is implemented.

### packages/vgen (later)

VGen-specific adapter implementing PlatformAdapter. Added when browser
automation is implemented.

### packages/gmail (later)

Gmail API client and email parser. Added when Gmail integration is
implemented.

### packages/discord (later)

Discord bot client. Added when Discord integration is implemented.

### packages/browser (later)

Playwright utilities and browser profile management. Added when browser
automation is implemented.

### packages/telegram (later)

Telegram bot client. Added if Telegram support is implemented.

---

## Data Flow: New Message Notification

```
VGen sends notification email
        ↓
Gmail receives email
        ↓
Gmail Pub/Sub pushes notification to Elysia webhook
        ↓
POST /api/v1/webhooks/google/gmail
        ↓
Validate Pub/Sub notification
        ↓
Fetch Gmail message via Gmail API
        ↓
Parse: is this a VGen notification? What type?
        ↓
Deduplicate: have we seen this event before?
        ↓
Persist event to PostgreSQL
        ↓
Publish PROCESS_GMAIL_EVENT to Redis Stream
        ↓
Worker picks up task
        ↓
Identify client, create/update client record
        ↓
Send Discord notification to creator
        ↓
Mark task complete
```

---

## Data Flow: Read Conversation

```
Creator types /read ErianOsamu in Discord
        ↓
Discord bot sends request to Elysia API
        ↓
POST /api/v1/agent/run { message: "read ErianOsamu conversation" }
        ↓
Create READ_VGEN_CONVERSATION task
        ↓
Publish to Redis Stream
        ↓
Worker picks up task
        ↓
Find client record for "ErianOsamu"
        ↓
Open authenticated Playwright session
        ↓
Navigate to VGen conversation
        ↓
Extract messages
        ↓
Persist messages to PostgreSQL
        ↓
Return conversation to Discord
```

---

## Data Flow: Draft → Approve → Send

```
Creator types /reply ErianOsamu I can start next week
        ↓
Agent reads conversation context
        ↓
Agent calls LLM with context + instruction
        ↓
LLM generates draft
        ↓
Draft saved to PostgreSQL (status: PENDING_APPROVAL)
        ↓
Draft shown in Discord with [Approve] [Edit] [Reject]
        ↓
Creator clicks [Approve]
        ↓
Approval recorded
        ↓
SEND_VGEN_MESSAGE task created
        ↓
Worker picks up task
        ↓
Safety checks:
  - Correct conversation?
  - Correct client?
  - Correct account?
  - Draft approved?
  - Draft unchanged since approval?
  - Approval still valid?
        ↓
Open Playwright, find conversation, send message
        ↓
Verify message appeared in conversation
        ↓
Persist outbound message
        ↓
Audit log entry
        ↓
Confirmation sent to Discord
```

---

## Repository Structure

```
client-agent/
├── apps/
│   ├── web/                    # SvelteKit frontend
│   ├── api/                    # Elysia HTTP API
│   └── worker/                 # Bun background workers
│
├── packages/
│   ├── db/                     # Drizzle schema + repositories
│   ├── domain/                 # Domain entities and contracts
│   ├── queue/                  # Redis Streams abstraction
│   ├── config/                 # Environment/config handling
│   └── shared/                 # Shared schemas/types/utilities
│
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   └── Dockerfile.worker
│   ├── docker-compose.yml      # Development (with Postgres + Redis)
│   └── docker-compose.prod.yml # Production (without Postgres + Redis)
│
├── docs/
│   ├── DESIGN.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── API.md
│   ├── AGENT.md
│   ├── PHASES.md
│   └── adr/
│
├── package.json
├── bunfig.toml
├── tsconfig.json
└── README.md
```

Packages are not all created upfront. They are extracted when a clear
boundary exists and the code is needed. Phase 0 creates: `db`, `domain`,
`queue`, `config`, `shared`. The rest are added in their respective
phases.

---

## Infrastructure

### Development

```
docker compose up        # Postgres + Redis
bun dev --filter=api     # Elysia on port 3001
bun dev --filter=web     # SvelteKit on port 5173
bun dev --filter=worker  # Worker process
```

### Production (Dokploy)

```
docker compose -f docker-compose.prod.yml up
```

This runs only the three application containers (api, web, worker).
Postgres and Redis are provided by the VPS's existing services,
connected via environment variables.

### Environment Variables

All secrets come from environment variables, never committed to the
repository. The `packages/config` package validates their presence at
startup and fails fast with clear error messages if anything is missing.

---

## Security Model

### Authentication

Single-user. Username and password hash stored in environment variables.
On successful login, a session ID is created and stored in Redis with a
TTL. The session ID is sent as an HTTP-only cookie. Every API request
checks the cookie against Redis.

### Browser Session (VGen)

A dedicated browser profile directory. The creator manually logs into
VGen once. Playwright reuses the session cookies from that profile. The
profile directory is never exposed publicly. If the session expires,
tasks pause and the creator is notified.

### Webhook Security

- Gmail Pub/Sub notifications are verified for authenticity.
- Idempotency keys prevent duplicate processing.
- Replay protection via timestamp checks.

### Data Privacy

- Conversation data is private. Access restricted to the owner.
- Sensitive credentials encrypted at rest.
- No message content in logs.
- Deletion mechanisms provided.
