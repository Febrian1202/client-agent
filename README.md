# ClientAgent

> **Personal AI Client Management Agent for VGen Creators**  
> An automated, queue-first assistant built for solo artists and creators selling commissions on [VGen](https://vgen.co). It connects Gmail notifications, Discord channels, and a SvelteKit web dashboard with resilient background workers and human-in-the-loop approval gates.

---

## 🌟 Key Capabilities & Highlights

- **⚡ Inbound Event Detection:** Real-time Gmail API + Google Cloud Pub/Sub push notifications for VGen events (messages, commission requests, stage reviews).
- **🛡️ 7-Point Safety Gate & Human-in-the-Loop:** External replies are *never* sent autonomously. Every message requires explicit human approval before delivery, with automatic approval revocation if drafts are modified.
- **🔄 Resilient Background Worker Engine:**
  - Deterministic state machine (`queued` → `running` → `completed` | `failed` → `dead`).
  - Exponential backoff retries (`2s`, `10s`, `30s`, `60s`) via Redis Sorted Sets.
  - Poison pill & phantom task protection with safe ACK handling.
  - Crash resilience & orphaned message recovery using Redis `XAUTOCLAIM`.
  - Graceful shutdown handling (`SIGTERM`/`SIGINT`) with in-flight active job drain (up to 15s).
- **🔒 Dedicated Browser Automation:** Playwright session reuse via persistent profile (`BROWSER_PROFILE_PATH`). No credential storage and zero attempts to bypass CAPTCHA/anti-bot systems.
- **📊 Modern Web Dashboard:** Built with SvelteKit, Tailwind CSS, shadcn-svelte, and Lucide icons.

---

## 🏗️ Architecture & Monorepo Structure

ClientAgent is structured as a TypeScript monorepo powered by **Bun Workspaces**:

```text
client-agent/
├── apps/
│   ├── api/          # Elysia REST API server (http://localhost:3001)
│   ├── web/          # SvelteKit web dashboard (http://localhost:5173)
│   └── worker/       # Standalone Bun background worker process
├── packages/
│   ├── config/       # Type-safe environment validation (Zod)
│   ├── db/           # PostgreSQL client, Drizzle ORM schemas & migrations
│   ├── discord/      # Discord bot client & notification formatting
│   ├── domain/       # Pure TypeScript entities, enums, and domain types
│   ├── gmail/        # Gmail API client, Pub/Sub webhook & VGen email parser
│   ├── queue/        # Redis Streams pub/sub, runner, retry & recovery engine
│   └── shared/       # Shared utilities (passwords, IDs, date helpers)
├── infrastructure/   # Docker Compose configurations (dev vs. prod) & Dockerfiles
├── docs/             # Architecture Decision Records (ADRs) and phase roadmaps
└── tests/            # Cross-workspace end-to-end integration tests
```

---

## 📋 Prerequisites

Before setting up the repository, ensure you have:

- **[Bun](https://bun.sh/)** `>= 1.1.0` (primary JavaScript runtime & package manager)
- **[Docker](https://www.docker.com/)** and **Docker Compose** (for running PostgreSQL 16 & Redis 7 locally)
- **Node.js** `>= 18` (optional, for tooling compatibility)
- **Git**

---

## 🚀 Quick Start / Local Setup

Follow these steps to get ClientAgent running locally:

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/client-agent.git
cd client-agent
```

### 2. Install Dependencies

Install all dependencies across all workspaces using Bun:

```bash
bun install
```

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and configure your settings. For local development, default values are provided for Postgres and Redis.

> **💡 Password Hash Generation:**  
> ClientAgent uses single-user authentication with Argon2id. Generate a secure password hash by running:
> ```bash
> bun -e 'console.log(await Bun.password.hash("your-password", { algorithm: "argon2id" }))'
> ```
> *Note:* When saving the Argon2id hash into `.env`, escape the dollar signs (`\$argon2id\$...`) or wrap the value in single quotes to prevent Bun/shell variable expansion.

### 4. Start Local Infrastructure (Postgres & Redis)

Start the local PostgreSQL and Redis containers using the development Compose file:

```bash
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
```

- **PostgreSQL:** `localhost:5433` (DB: `client_agent`, User: `postgres`, Pass: `postgres`)
- **Redis:** `localhost:6380`

### 5. Run Database Migrations & Seeds

Apply the database schema and initialize the owner user:

```bash
# Run database migrations
bun run --filter=@client-agent/db db:migrate

# (Optional) Seed initial data
bun run --filter=@client-agent/db seed
```

### 6. Start the Development Servers

Run all applications concurrently:

```bash
bun dev
```

Or start specific applications independently:

```bash
bun --filter=@client-agent/api dev      # Elysia API on http://localhost:3001
bun --filter=@client-agent/web dev      # SvelteKit Dashboard on http://localhost:5173
bun --filter=@client-agent/worker dev   # Background Worker process
```

---

## 🧪 Testing & Code Quality

The repository has an extensive test suite covering unit, integration, and end-to-end scenarios:

```bash
# Run all tests across the monorepo
bun test

# Run tests for specific packages
bun test packages/db
bun test packages/queue
bun test packages/gmail
bun test packages/discord
bun test apps/api
bun test apps/worker

# Run End-to-End integration tests
bun test tests/e2e-event-pipeline.test.ts     # Inbound event pipeline E2E
bun test tests/e2e-worker-hardening.test.ts   # Worker state machine & recovery E2E

# Typecheck all workspaces (TypeScript & SvelteKit)
bun run typecheck
```

---

## 📌 Implementation Roadmap

| Phase | Description | Status |
|:---:|---|:---:|
| **Phase 0** | Monorepo foundation, Bun workspaces, Elysia, SvelteKit, Drizzle, Redis, Docker | **Completed** |
| **Phase 1** | Inbound Event Pipeline (Gmail Pub/Sub → VGen Parser → Deduplication → Discord) | **Completed** |
| **Phase 2** | Worker Hardening (State machine, exponential backoff, crash recovery, graceful shutdown) | **Completed** |
| **Phase 3** | VGen Browser Reader (Playwright session reuse, PlatformAdapter, conversation syncing) | *Next Up* |
| **Phase 4** | AI Agent & Prompt Layer (LLM provider abstraction, context summarization, drafting) | *Pending* |
| **Phase 5** | Human-in-the-Loop Approval System (Draft lifecycle, Discord buttons, invalidation) | *Pending* |
| **Phase 6** | VGen Message Sending Automation (7-Point Safety Gate, post-send verification, audit log) | *Pending* |
| **Phase 7** | SvelteKit Creator Web Dashboard (Task monitor, conversations, drafts, client notes) | *Pending* |
| **Phase 8** | Client Long-Term Memory (`FACT`, `PREFERENCE`, `INFERENCE` persistent context) | *Pending* |

---

## 📖 Documentation

Detailed documentation and architectural decision records can be found in `docs/`:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design and data flow diagrams.
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — PostgreSQL ERD, schema specifications, and indexes.
- [docs/API.md](docs/API.md) — REST API endpoints, payload schemas, and error codes.
- [docs/DESIGN.md](docs/DESIGN.md) — Core principles, daily flow, and non-goals.
- [docs/adr/](docs/adr/) — 12 Architecture Decision Records explaining key technology choices.
- [AGENTS.md](AGENTS.md) — Guidelines and operational rules for AI coding agents.

---

## 🛡️ License

Private, personal automation project for solo VGen creators.
