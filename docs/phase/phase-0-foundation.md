# Phase 0 — Foundation: Step-by-Step Implementation Guide

> **Goal:** Build the complete monorepo foundation with Bun workspaces, Elysia API, SvelteKit shell, background worker, Drizzle ORM connected to PostgreSQL, Redis connection, and Docker configs.
> **Prerequisites:** Bun installed on host machine, Docker installed for local development.

---

## Architecture Context for This Phase

In Phase 0, we do **not** write any AI code, browser automation, or external integrations (Gmail/Discord).
We set up a working, deployable skeleton:
- Monorepo structure managed by Bun
- 3 runnable apps: `api`, `web`, `worker`
- 5 shared packages: `db`, `domain`, `queue`, `config`, `shared`
- Single-user session authentication (username + password hash in env, session in Redis)
- Health and readiness check endpoints
- Docker Compose for dev (with Postgres + Redis) and prod (apps only)

---

## Atomic Task Breakdown

### Task 0.1: Root Workspace & Monorepo Configuration
- [x] Create root `package.json` with Bun workspaces configuration:
  ```json
  {
    "name": "client-agent-root",
    "private": true,
    "workspaces": [
      "apps/*",
      "packages/*"
    ],
    "scripts": {
      "dev:api": "bun --filter=@client-agent/api dev",
      "dev:web": "bun --filter=@client-agent/web dev",
      "dev:worker": "bun --filter=@client-agent/worker dev",
      "dev": "bun --filter='*' dev",
      "build": "bun --filter='*' build",
      "lint": "bun --filter='*' lint",
      "test": "bun test"
    }
  }
  ```
- [x] Create root `tsconfig.json` with strict TypeScript configuration and path aliases mapping `@client-agent/*` to `packages/*/src`.
- [x] Create `.gitignore` ignoring `node_modules`, `.env`, `.env.local`, `dist`, `build`, `.svelte-kit`.
- [x] Create `.env.example` documenting all configuration keys needed across all apps.

---

### Task 0.2: `packages/domain` (Pure Types & Contracts)
- [x] Create `packages/domain/package.json` (name: `@client-agent/domain`).
- [x] Create `packages/domain/src/index.ts` exporting:
  - Enums: `TaskStatus` (`queued`, `running`, `completed`, `failed`, `dead`), `TaskType`, `DraftStatus`, `CommissionStatus`, `EventStatus`, `AuditAction`.
  - Base entity interfaces: `User`, `Client`, `Conversation`, `Message`, `Commission`, `Event`, `AgentTask`, `AgentRun`, `Draft`, `Approval`, `AuditLog`.
  - Session types: `SessionData` (`userId`, `username`, `createdAt`, `expiresAt`).
  - Standard API response envelopes: `ApiResponse<T>`, `ApiErrorResponse`, `PaginatedResponse<T>`.

---

### Task 0.3: `packages/config` (Environment Schema & Validation)
- [x] Create `packages/config/package.json` (name: `@client-agent/config`).
- [x] Install validation library (e.g. `zod` or Elysia's `@sinclair/typebox`).
- [x] Implement `env.ts` validating:
  - `NODE_ENV` (`development` | `production` | `test`)
  - `PORT` (default 3001)
  - `APP_URL`
  - `DATABASE_URL`
  - `REDIS_URL`
  - `AUTH_USERNAME`
  - `AUTH_PASSWORD_HASH` (bcrypt/argon2 hash)
  - `AUTH_SECRET`
- [x] Provide an exported `config` object that throws immediately with clear missing-key messages if any variable is invalid.

---

### Task 0.4: `packages/shared` (Shared Utilities)
- [x] Create `packages/shared/package.json` (name: `@client-agent/shared`).
- [x] Implement password hashing and verification helper (`src/crypto.ts`) using `Bun.password` (bcrypt/argon2).
- [x] Implement standardized ID generation helper (`src/id.ts`) if needed.
- [x] Implement date and error normalization helpers.

---

### Task 0.5: `packages/db` (PostgreSQL + Drizzle ORM)
- [x] Create `packages/db/package.json` (name: `@client-agent/db`) with `drizzle-orm` and `postgres`.
- [x] Install `drizzle-kit` as a dev dependency.
- [x] Create `drizzle.config.ts`.
- [x] Define `packages/db/src/schema/users.ts`:
  - `id`: `bigserial` primary key
  - `name`: `varchar(255)`
  - `email`: `varchar(255)` unique
  - `created_at`, `updated_at`: `timestamp with time zone` default `now()`
- [x] Create database client instance (`src/client.ts`) using `postgres.js` and `drizzle`.
- [x] Add migration script (`bun run db:generate` and `bun run db:migrate`).
- [x] Implement initial seed script (`src/seed.ts`) to ensure the default admin user exists if the `users` table is empty.

---

### Task 0.6: `packages/queue` (Redis Streams Abstraction)
- [x] Create `packages/queue/package.json` (name: `@client-agent/queue`) with `ioredis`.
- [x] Create Redis connection factory (`src/connection.ts`) reading from `@client-agent/config`.
- [x] Implement Stream Producer (`src/producer.ts`):
  - Function `publishTask(streamName: string, payload: Record<string, any>): Promise<string>`
  - Handles `XADD` to specified stream name.
- [x] Implement Stream Consumer (`src/consumer.ts`):
  - Function `createConsumerGroup(streamName: string, groupName: string): Promise<void>`
  - Function `consumeTasks(...)` wrapping `XREADGROUP`, auto-ack option, and error handling.
- [x] Define Redis Stream constant names (`client-agent:events`, `client-agent:notifications`, `client-agent:agent`, etc.).

---

### Task 0.7: `apps/api` (Elysia HTTP Backend)
- [x] Initialize `apps/api/package.json` (name: `@client-agent/api`) with `elysia`, `@elysiajs/cors`, `@elysiajs/cookie`.
- [x] Setup `src/index.ts` creating the Elysia server instance on configured `PORT`.
- [x] Implement Health endpoints:
  - `GET /health` -> `{ status: "ok", timestamp: string }`
  - `GET /health/ready` -> checks PostgreSQL query (`SELECT 1`) and Redis `PING`. Returns 200 `{ status: "ready", database: "ok", redis: "ok" }` or 503 on failure.
- [x] Implement Session Store in Redis (`src/auth/session.ts`):
  - `createSession(userId: number, username: string): Promise<string>` (saves with TTL e.g. 7 days).
  - `getSession(sessionId: string): Promise<SessionData | null>`
  - `deleteSession(sessionId: string): Promise<void>`
- [x] Implement Authentication routes (`src/routes/auth.ts`):
  - `POST /api/v1/auth/login` (checks username & password hash against env/config, creates Redis session, sets HTTP-only cookie `session`).
  - `POST /api/v1/auth/logout` (destroys Redis session, clears cookie).
  - `GET /api/v1/auth/me` (reads session cookie, validates, returns user).
- [x] Implement Auth middleware/macro protecting `/api/v1/*` routes except `/auth/login` and `/health*`.

---

### Task 0.8: `apps/worker` (Bun Background Worker)
- [x] Initialize `apps/worker/package.json` (name: `@client-agent/worker`).
- [x] Create `src/index.ts`:
  - Connect to Redis.
  - Setup graceful shutdown handlers (`SIGTERM`, `SIGINT`).
  - Start an internal heartbeat loop that logs every 30s (`Worker heartbeat - alive at ...`).
  - Initialize consumer group for a test/events stream.
  - Listen for incoming tasks using `consumeTasks` from `@client-agent/queue` and log received tasks.

---

### Task 0.9: `apps/web` (SvelteKit Frontend Shell)
- [x] Initialize SvelteKit app in `apps/web` with TypeScript.
- [x] Configure Tailwind CSS.
- [x] Install and configure `shadcn-svelte` and `lucide-svelte`.
- [x] Create basic app layout (`src/routes/+layout.svelte`):
  - Simple clean container with header and navigation shell.
- [x] Create Login page (`src/routes/login/+page.svelte`):
  - Username and password form.
  - Submits to `/api/v1/auth/login`.
  - Displays error toast/banner on invalid credentials.
- [x] Create Dashboard placeholder page (`src/routes/dashboard/+page.svelte`):
  - Shows "ClientAgent Dashboard - Phase 0 Shell".
  - Shows current logged-in user and logout button.

---

### Task 0.10: Docker & Deployment Configurations
- [x] Create `infrastructure/docker/Dockerfile.api` (multi-stage Bun build).
- [x] Create `infrastructure/docker/Dockerfile.worker` (multi-stage Bun build).
- [x] Create `infrastructure/docker/Dockerfile.web` (builds SvelteKit with node/bun adapter).
- [x] Create `infrastructure/docker-compose.yml` (Development):
  - Services: `postgres` (port 5432), `redis` (port 6379), volumes for persistence.
  - Optional services for api, web, worker or run them on host via `bun dev`.
- [x] Create `infrastructure/docker-compose.prod.yml` (Production / Dokploy):
  - Services: `api`, `web`, `worker` only.
  - Environment variables point to existing VPS PostgreSQL and Redis instances.

---

## Verification & Testing Steps

1. **Start Dev Infrastructure:**
   ```bash
   docker compose -f infrastructure/docker-compose.yml up -d postgres redis
   ```
   Verify both containers are healthy.

2. **Run Migrations & Seed:**
   ```bash
   bun run --filter=@client-agent/db db:migrate
   bun run --filter=@client-agent/db seed
   ```

3. **Start All Applications:**
   ```bash
   bun dev
   ```
   Confirm:
   - `apps/api` starts on http://localhost:3001
   - `apps/web` starts on http://localhost:5173
   - `apps/worker` starts and logs its heartbeat

4. **Verify Health & Auth Endpoints:**
   ```bash
   curl -i http://localhost:3001/health
   curl -i http://localhost:3001/health/ready
   ```
   Both must return HTTP 200 with JSON bodies.

   Test Login:
   ```bash
   curl -i -X POST http://localhost:3001/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"yourpassword"}'
   ```
   Must return HTTP 200 with `Set-Cookie: session=...; HttpOnly; SameSite=Strict`.

5. **Verify Queue Communication:**
   From a simple test script, publish a message to `client-agent:events`. Confirm the worker console prints the received task.

---

## Done When Checklist
- [x] Root workspace installs cleanly with `bun install`.
- [x] `docker compose -f infrastructure/docker-compose.yml up` brings up Postgres and Redis.
- [x] Database migrations execute successfully without errors.
- [x] `GET /health` and `GET /health/ready` respond with 200 OK.
- [x] Login via API returns a valid session cookie and stores session in Redis.
- [x] SvelteKit displays the login page and can authenticate with the API.
- [x] Background worker boots, prints heartbeat, and successfully receives a Redis Streams message.
- [x] `infrastructure/docker-compose.prod.yml` validates without Postgres/Redis containers.
