# Phase 1 — Event Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VGen notification email → parsed event stored once in PostgreSQL → Redis Stream task → Bun worker resolves the client and delivers exactly one Discord notification.

**Architecture:** Google Pub/Sub push hits an Elysia webhook that verifies the OIDC token, pulls new messages from the Gmail API (single bounded page), parses VGen notification emails, inserts an `events` row guarded by a unique `external_id`, and enqueues a `PROCESS_GMAIL_EVENT` task. `apps/worker` has one consumer loop per stream: `PROCESS_GMAIL_EVENT` upserts the client and enqueues `NOTIFY_DISCORD` on the notifications stream; `NOTIFY_DISCORD` posts one message through the Discord REST API. No AI, no browser automation in this phase.

**Tech Stack:** Bun workspaces, TypeScript (strict), Elysia + TypeBox, Drizzle ORM 0.39 + `postgres.js`, Redis Streams (`ioredis`), `discord.js` REST client, Web Crypto (AES-GCM, RS256), `bun:test`.

**Spec:** `docs/phase/phase-1-event-pipeline.md` (read with `docs/DATA_MODEL.md` §events/clients/agent_tasks/integrations, `docs/ARCHITECTURE.md` §Data Flow: New Message Notification, `docs/adr/007-gmail-pubsub.md`).

## Global Constraints

- Zero AI and zero browser automation in this phase. No `packages/ai`, no Playwright, no VGen scraping.
- Queue-first (ADR-005 / AGENTS.md §2.4): no Playwright, no LLM, no Gmail *sync loop* inside an HTTP handler. The webhook may perform exactly one bounded Gmail read (≤ 25 messages, one `history.list` + one `messages.get` per message) and must answer Pub/Sub within ~10 s; anything longer belongs in the worker.
- Dedup is enforced by the database: `events.external_id` is UNIQUE. Webhook code must use `ON CONFLICT DO NOTHING`, never check-then-insert.
- An event must produce at most one `NOTIFY_DISCORD` task; `agent_tasks.idempotency_key` format is `gmail_event:<eventId>:process` and `gmail_event:<eventId>:notify`.
- Never log message bodies, tokens, or refresh tokens. Only IDs, subjects, usernames, and statuses.
- No message content is stored in this phase: the notification email carries none, and nothing may be fabricated to fill the gap (AGENTS.md §2.6).
- Env values come from `@client-agent/config` only; no `process.env` reads in packages (`WORKER_ID` in `apps/worker/src/index.ts` is the existing exception).
- Timestamps are `timestamp with time zone`; enum-valued columns store the lowercase values from `packages/domain/src/enums.ts`.
- Everything ends green on `bun test` and `bun run typecheck` (root), with Postgres + Redis from `docker compose -f infrastructure/docker-compose.yml up -d postgres redis`.

## Review Focus

Inputs and failure modes the spec implies but does not spell out. Each line has a test in the task that owns the code.

1. **Unknown VGen subject wording** — VGen changes copy; the message must still be stored and notified as `unknown`, never silently dropped. (Task 5)
2. **Duplicate / stale Pub/Sub delivery** — Google redelivers pushes and may repeat an older `historyId`; the second delivery must create no event, no task, and no Discord message. (Tasks 3, 8)
3. **Gmail history expiry (`404` on `history.list`)** — a quiet mailbox drops history; the webhook must re-bootstrap from `users.getProfile` and return 200, not 500. (Tasks 6, 8)
4. **Revoked / expired Google credentials** — a token refresh failure must return 200 to Pub/Sub, mark the `gmail` integration `error`, and not crash the API. (Tasks 8, 12)
5. **Discord failure (channel deleted, bot lacks permission)** — `NOTIFY_DISCORD` must record the error and mark the task `failed` without duplicating the notification on replay. (Task 11)

---

### Task 1: Credential encryption in `packages/shared`

**Files:**
- Create: `packages/shared/src/secret.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/secret.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encryptSecret(plaintext: string, secret: string): Promise<string>` and `decryptSecret(payload: string, secret: string): Promise<string>`. Sealed format `v1.<base64url(iv)>.<base64url(ciphertext)>`, AES-256-GCM, 12-byte random IV, key = `SHA-256(secret)` imported as `raw` `AES-GCM`. The `secret` argument is always `config.AUTH_SECRET` at the call site (Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/secret.test.ts
import { describe, expect, it } from 'bun:test';
import { decryptSecret, encryptSecret } from '../src/secret';

describe('secret encryption', () => {
  const secret = 'test_secret_key';

  it('round-trips a plaintext payload', async () => {
    const sealed = await encryptSecret('{"refreshToken":"1//abc"}', secret);
    expect(await decryptSecret(sealed, secret)).toBe('{"refreshToken":"1//abc"}');
  });

  it('produces a v1 envelope with a fresh IV per call', async () => {
    const a = await encryptSecret('same', secret);
    const b = await encryptSecret('same', secret);
    expect(a.startsWith('v1.')).toBeTrue();
    expect(a).not.toBe(b);
    expect(a.split('.')).toHaveLength(3);
  });

  it('rejects a tampered payload', async () => {
    const sealed = await encryptSecret('sensitive', secret);
    const parts = sealed.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from('garbage').toString('base64url')}`;
    expect(decryptSecret(tampered, secret)).rejects.toThrow();
  });

  it('rejects the wrong secret', async () => {
    const sealed = await encryptSecret('sensitive', secret);
    expect(decryptSecret(sealed, 'other_secret')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/tests/secret.test.ts`
Expected: FAIL — `Cannot find module '../src/secret'`.

- [ ] **Step 3: Implement `packages/shared/src/secret.ts` behind `encryptSecret` / `decryptSecret`, export from `src/index.ts`**

Use `crypto.subtle.digest('SHA-256', ...)` → `importKey('raw', ..., { name: 'AES-GCM' })`; `getRandomValues` for the IV; `base64url` via `Buffer`. First `.`-segment must be `v1`, otherwise throw `Error('Unsupported secret format')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/shared/tests/secret.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/secret.ts packages/shared/src/index.ts packages/shared/tests/secret.test.ts
git commit -m "feat(shared): add AES-GCM secret sealing for integration credentials"
```

---

### Task 2: Event, stream, and payload contracts in `packages/domain`

**Files:**
- Create: `packages/domain/src/events.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/events.test.ts`

**Interfaces:**
- Consumes: `TaskType` from `./enums`.
- Produces:
  - `enum VGenEventType { NEW_MESSAGE = 'new_message', NEW_COMMISSION = 'new_commission', COMMISSION_CONFIRMED = 'commission_confirmed', COMMISSION_UPDATED = 'commission_updated', COMMISSION_COMPLETED = 'commission_completed', UNKNOWN = 'unknown' }` — the string values are what `events.event_type` stores.
  - `interface VGenParsedEvent { source: 'gmail'; provider: 'vgen'; eventType: VGenEventType; externalId: string; clientUsername: string | null; commissionId: string | null; from: string; subject: string; receivedAt: Date }`
  - `interface VGenEventPayload { subject: string; from: string; date: string; clientUsername: string | null; commissionId: string | null; historyId: string }` — stored in `events.payload`.
  - `interface TaskStreamMessage { type: TaskType; taskId: string }` — the flat field pair written to Redis Streams.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/tests/events.test.ts
import { describe, expect, it } from 'bun:test';
import { TaskType, VGenEventType } from '../src/index';

describe('VGen event contracts', () => {
  it('stores lowercase snake_case event types matching events.event_type', () => {
    expect(VGenEventType.NEW_MESSAGE).toBe('new_message');
    expect(VGenEventType.NEW_COMMISSION).toBe('new_commission');
    expect(VGenEventType.COMMISSION_CONFIRMED).toBe('commission_confirmed');
    expect(VGenEventType.COMMISSION_UPDATED).toBe('commission_updated');
    expect(VGenEventType.COMMISSION_COMPLETED).toBe('commission_completed');
    expect(VGenEventType.UNKNOWN).toBe('unknown');
  });

  it('keeps stream messages on existing TaskType values', () => {
    expect(TaskType.PROCESS_GMAIL_EVENT).toBe('PROCESS_GMAIL_EVENT');
    expect(TaskType.NOTIFY_DISCORD).toBe('NOTIFY_DISCORD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/domain/tests/events.test.ts`
Expected: FAIL — `VGenEventType` is not exported.

- [ ] **Step 3: Create `packages/domain/src/events.ts` with the four declarations above and re-export from `src/index.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/domain/tests/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/events.ts packages/domain/src/index.ts packages/domain/tests/events.test.ts
git commit -m "feat(domain): add VGen event types, event payload, and stream message contracts"
```

---

### Task 3: `events`, `clients`, `agent_tasks`, `integrations` schema + migration

**Files:**
- Create: `packages/db/src/schema/events.ts`, `packages/db/src/schema/clients.ts`, `packages/db/src/schema/agent_tasks.ts`, `packages/db/src/schema/integrations.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/package.json` (add `@client-agent/domain` dependency — pure types, no runtime cycle)
- Generated: `packages/db/drizzle/0001_*.sql`
- Test: `packages/db/tests/schema.test.ts`

**Interfaces:**
- Consumes: `VGenEventPayload`, `VGenEventType` and `TaskType`, `TaskStatus`, `EventStatus` from `@client-agent/domain`.
- Produces (row types exported next to each table, following `users.ts`):
  - `events`: `id bigserial PK`, `source varchar(50) not null`, `provider varchar(50) not null`, `eventType varchar(100) not null` (`$type<VGenEventType>`), `externalId varchar(255) not null unique`, `payload jsonb $type<VGenEventPayload> not null default {}`, `status varchar(50) $type<EventStatus> not null default 'received'`, `receivedAt timestamptz not null default now()`, `processedAt timestamptz null`, `createdAt`/`updatedAt timestamptz not null default now()`; types `EventRow`, `NewEventRow`.
  - `clients`: `id`, `userId bigint not null → users.id`, `platform varchar(50) not null default 'vgen'`, `externalId varchar(255) null`, `username varchar(255) not null`, `displayName varchar(255) null`, `profileUrl varchar(1024) null`, `avatarUrl varchar(1024) null`, `metadata jsonb not null default {}`, `firstSeenAt`/`lastSeenAt timestamptz not null default now()`, `createdAt`/`updatedAt`; unique constraint `clients_user_platform_username` on `(userId, platform, username)`; types `ClientRow`, `NewClientRow`.
  - `agent_tasks`: `id`, `userId bigint not null → users.id`, `eventId bigint null → events.id`, `type varchar(100) $type<TaskType> not null`, `status varchar(50) $type<TaskStatus> not null default 'queued'`, `input jsonb not null default {}`, `output jsonb null`, `attempts integer not null default 0`, `maxAttempts integer not null default 5`, `idempotencyKey varchar(255) null`, `error text null`, `startedAt`/`completedAt timestamptz null`, `createdAt`/`updatedAt`; types `AgentTaskRow`, `NewAgentTaskRow`.
  - `integrations`: `id`, `userId bigint not null → users.id`, `provider varchar(50) not null`, `status varchar(50) not null default 'disconnected'`, `credentialsEncrypted text null`, `metadata jsonb not null default {}`, `createdAt`/`updatedAt`; unique constraint `integrations_user_provider` on `(userId, provider)`; types `IntegrationRow`, `NewIntegrationRow`.
  - Third `pgTable` argument uses the **array** form (`(t) => [unique('clients_user_platform_username').on(t.userId, t.platform, t.username)]`) — the object form is deprecated in drizzle-orm 0.39.3.
  - Columns use `varchar` with explicit lengths, matching `users.ts`, rather than the bare `text` written in `docs/DATA_MODEL.md`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/tests/schema.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db, users } from '../src/index';
import { clients, events, agent_tasks, integrations } from '../src/schema';
import { VGenEventType, TaskType } from '@client-agent/domain';

const ownerId = async () => {
  const rows = await db.select().from(users).orderBy(sql`id asc`).limit(1);
  if (rows[0]) return rows[0].id;
  const inserted = await db.insert(users).values({ name: 'schema-test', email: 'schema-test@localhost' }).returning();
  return inserted[0]!.id;
};

// Cleanup deletes only the rows this file created, by id, so a concurrent suite is never touched.
const createdIds: { events: number[]; clients: number[]; agentTasks: number[]; integrations: number[] } = {
  events: [], clients: [], agentTasks: [], integrations: [],
};

afterAll(async () => {
  for (const id of createdIds.agentTasks) await db.delete(agent_tasks).where(eq(agent_tasks.id, id));
  for (const id of createdIds.events) await db.delete(events).where(eq(events.id, id));
  for (const id of createdIds.clients) await db.delete(clients).where(eq(clients.id, id));
  for (const id of createdIds.integrations) await db.delete(integrations).where(eq(integrations.id, id));
});

describe('Phase 1 schema', () => {
  it('rejects a duplicate events.external_id (dedup anchor)', async () => {
    const row = { source: 'schema-test', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE, externalId: `schema-dup-${Date.now()}` };
    const first = await db.insert(events).values(row).returning();
    createdIds.events.push(first[0]!.id);
    await expect(db.insert(events).values(row)).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects a duplicate (user_id, platform, username) client', async () => {
    const userId = await ownerId();
    const row = { userId, platform: 'vgen', username: `SchemaTestUser${Date.now()}` };
    const first = await db.insert(clients).values(row).returning();
    createdIds.clients.push(first[0]!.id);
    await expect(db.insert(clients).values(row)).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects a duplicate (user_id, provider) integration', async () => {
    const userId = await ownerId();
    const row = { userId, provider: `schema-test-${Date.now()}` };
    const first = await db.insert(integrations).values(row).returning();
    createdIds.integrations.push(first[0]!.id);
    await expect(db.insert(integrations).values(row)).rejects.toThrow(/duplicate key|unique/i);
  });

  it('defaults agent_tasks to queued with attempts 0 and max_attempts 5', async () => {
    const userId = await ownerId();
    const inserted = await db.insert(agent_tasks).values({ userId, type: TaskType.PROCESS_GMAIL_EVENT, input: {} }).returning();
    createdIds.agentTasks.push(inserted[0]!.id);
    expect(inserted[0]!.status as string).toBe('queued');
    expect(inserted[0]!.attempts).toBe(0);
    expect(inserted[0]!.maxAttempts).toBe(5);
    expect(inserted[0]!.startedAt).toBeNull();
  });

  it('defaults events to received with received_at set', async () => {
    const inserted = await db.insert(events).values({
      source: 'schema-test', provider: 'vgen', eventType: VGenEventType.UNKNOWN, externalId: `schema-default-${Date.now()}`,
    }).returning();
    createdIds.events.push(inserted[0]!.id);
    expect(inserted[0]!.status as string).toBe('received');
    expect(inserted[0]!.receivedAt).toBeInstanceOf(Date);
    expect(inserted[0]!.processedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -f infrastructure/docker-compose.yml up -d postgres redis && bun test packages/db/tests/schema.test.ts`
Expected: FAIL — relation `events` does not exist.

- [ ] **Step 3: Write the four schema files, export them from `packages/db/src/schema/index.ts`, add the `@client-agent/domain` dependency, then generate and run the migration**

Run:
```bash
bun install
bun run --filter=@client-agent/db db:generate
bun run --filter=@client-agent/db db:migrate
```
Expected: `packages/db/drizzle/0001_*.sql` created with `CREATE TABLE "events"`, `"clients"`, `"agent_tasks"`, `"integrations"` and their unique constraints; migration output reports success.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/tests/schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema packages/db/drizzle packages/db/package.json packages/db/tests/schema.test.ts bun.lock
git commit -m "feat(db): add events, clients, agent_tasks, and integrations schema with migration"
```

---

### Task 4: Query helpers in `packages/db`

**Files:**
- Create: `packages/db/src/queries/index.ts`, `packages/db/src/queries/owner.ts`, `packages/db/src/queries/events.ts`, `packages/db/src/queries/tasks.ts`, `packages/db/src/queries/clients.ts`, `packages/db/src/queries/integrations.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/queries.test.ts`

**Interfaces:**
- Consumes: schema row types from Task 3; `TaskType`, `TaskStatus`, `VGenEventPayload` from `@client-agent/domain`.
- Produces:
  - `getOwnerUserId(): Promise<number>` — lowest `users.id`; throws `Error('No user row found - run bun run --filter=@client-agent/db seed')` when empty.
  - `insertEventIfNew(input: { source: string; provider: string; eventType: VGenEventType; externalId: string; payload: VGenEventPayload; receivedAt: Date }): Promise<EventRow | null>` — `insert(...).onConflictDoNothing({ target: events.externalId }).returning()`, returns `rows[0] ?? null`.
  - `getEventById(id: number): Promise<EventRow | null>`
  - `markEventProcessed(id: number): Promise<void>` (sets `status = 'processed'`, `processed_at = now()`)
  - `markEventFailed(id: number): Promise<void>`
  - `createTask(input: { userId: number; eventId?: number | null; type: TaskType; input: Record<string, unknown>; idempotencyKey?: string }): Promise<AgentTaskRow>`
  - `getTaskById(id: number): Promise<AgentTaskRow | null>`
  - `findTaskByIdempotencyKey(key: string): Promise<AgentTaskRow | null>`
  - `markTaskRunning(id: number): Promise<void>` (`status='running'`, `started_at=now()`, `attempts = attempts + 1`)
  - `markTaskCompleted(id: number, output: Record<string, unknown>): Promise<void>`
  - `markTaskFailed(id: number, error: string): Promise<void>`
  - `upsertClient(input: { userId: number; platform: string; username: string; displayName?: string | null }): Promise<ClientRow>` — `onConflictDoUpdate` on `(userId, platform, username)` setting `last_seen_at = now()`, `updated_at = now()`
  - `getClientByUsername(userId: number, platform: string, username: string): Promise<ClientRow | null>`
  - `getIntegration(userId: number, provider: string): Promise<IntegrationRow | null>`
  - `upsertIntegration(input: { userId: number; provider: string; status: string; credentialsEncrypted?: string | null; metadata?: Record<string, unknown> }): Promise<IntegrationRow>`
  - `deleteIntegration(userId: number, provider: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/tests/queries.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db, getOwnerUserId, insertEventIfNew, getEventById, markEventProcessed,
  createTask, getTaskById, findTaskByIdempotencyKey, markTaskRunning, markTaskCompleted,
  upsertClient, getClientByUsername, upsertIntegration, getIntegration, deleteIntegration,
  agentTasks, events, clients, integrations,
} from '../src/index';
import { TaskType, VGenEventType } from '@client-agent/domain';

const externalId = `queries-${Date.now()}`;
const username = `QueriesUser${Date.now()}`;
const provider = `queries-test-${Date.now()}`;

afterAll(async () => {
  await db.delete(agentTasks).where(eq(agentTasks.idempotencyKey, `queries:${externalId}`));
  await db.delete(events).where(eq(events.externalId, externalId));
  await db.delete(clients).where(eq(clients.username, username));
  await db.delete(integrations).where(eq(integrations.provider, provider));
});

describe('Phase 1 query helpers', () => {
  it('returns the owner user id', async () => {
    expect(await getOwnerUserId()).toBeGreaterThan(0);
  });

  it('inserts an event once and returns null on the duplicate', async () => {
    const input = {
      source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE,
      externalId, payload: { subject: 's', from: 'f', date: 'd', clientUsername: username, commissionId: null, historyId: '1' },
      receivedAt: new Date('2026-10-16T14:32:00Z'),
    };
    const first = await insertEventIfNew(input);
    expect(first).not.toBeNull();
    expect(await insertEventIfNew(input)).toBeNull();
    await markEventProcessed(first!.id);
    expect((await getEventById(first!.id))!.status as string).toBe('processed');
  });

  it('creates a task, finds it by idempotency key, and walks running -> completed', async () => {
    const userId = await getOwnerUserId();
    const task = await createTask({ userId, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: 1 }, idempotencyKey: `queries:${externalId}` });
    expect(task.status as string).toBe('queued');
    expect((await findTaskByIdempotencyKey(`queries:${externalId}`))!.id).toBe(task.id);
    await markTaskRunning(task.id);
    const running = await getTaskById(task.id);
    expect(running!.status as string).toBe('running');
    expect(running!.attempts).toBe(1);
    expect(running!.startedAt).toBeInstanceOf(Date);
    await markTaskCompleted(task.id, { messageId: 'm1' });
    const done = await getTaskById(task.id);
    expect(done!.status as string).toBe('completed');
    expect(done!.output).toEqual({ messageId: 'm1' });
  });

  it('upserts a client in place and refreshes last_seen_at', async () => {
    const userId = await getOwnerUserId();
    const first = await upsertClient({ userId, platform: 'vgen', username });
    const second = await upsertClient({ userId, platform: 'vgen', username });
    expect(second.id).toBe(first.id);
    expect(second.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
    expect((await getClientByUsername(userId, 'vgen', username))!.id).toBe(first.id);
  });

  it('upserts and deletes an integration', async () => {
    const userId = await getOwnerUserId();
    await upsertIntegration({ userId, provider, status: 'connected', credentialsEncrypted: 'v1.a.b', metadata: { channelId: 'c1' } });
    await upsertIntegration({ userId, provider, status: 'error', metadata: { channelId: 'c1' } });
    const row = await getIntegration(userId, provider);
    expect(row!.status).toBe('error');
    expect(row!.metadata).toEqual({ channelId: 'c1' });
    await deleteIntegration(userId, provider);
    expect(await getIntegration(userId, provider)).toBeNull();
  });
});
```

The cleanup runs on the top-level `db` import; no dynamic imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/queries.test.ts`
Expected: FAIL — `getOwnerUserId` is not exported.

- [ ] **Step 3: Implement the five query modules and re-export from `packages/db/src/index.ts`**

Use `sql\`now()\`` for timestamp updates. `upsertClient` conflicts on the three columns; `upsertIntegration` conflicts on `(userId, provider)` and overwrites `status`, `credentialsEncrypted`, `metadata`, `updatedAt`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/tests/queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries packages/db/src/index.ts packages/db/tests/queries.test.ts
git commit -m "feat(db): add event, task, client, integration, and owner query helpers"
```

---

### Task 5: VGen email parser in `packages/gmail`

**Files:**
- Create: `packages/gmail/package.json`, `packages/gmail/src/index.ts`, `packages/gmail/src/parser.ts`
- Modify: `tsconfig.json` (add `@client-agent/gmail` / `@client-agent/gmail/*` path aliases next to the existing entries)
- Test: `packages/gmail/tests/parser.test.ts`

**Interfaces:**
- Consumes: `VGenEventType`, `VGenParsedEvent` from `@client-agent/domain`.
- Produces:
  - `interface VGenEmailInput { id: string; subject: string; from: string; date: string }`
  - `isVGenSender(from: string): boolean` — lowercases; strips a `Name <addr>` wrapper; true only for `@vgen.co` (so `no-reply@vgen.co` and `hello@vgen.co` pass, `noreply@vgen.co.evil.com` fails).
  - `parseVGenEmail(email: VGenEmailInput): VGenParsedEvent | null` — `null` only when the sender is not VGen or `id` is empty.
  - Subject rules, first match wins (regexes anchored, case-insensitive on the leading word):
    1. `/^@?([A-Za-z0-9_]+)\s+sent you a new message!?$/i` → `NEW_MESSAGE`, `clientUsername = $1`
    2. `/^New commission request from\s+@?([A-Za-z0-9_]+)/i` → `NEW_COMMISSION`, `clientUsername = $1`
    3. `/^Commission #([A-Za-z0-9-]+)\s+updated/i` → `COMMISSION_UPDATED`, `commissionId = $1`
    4. `/^Commission #([A-Za-z0-9-]+)\s+confirmed/i` → `COMMISSION_CONFIRMED`, `commissionId = $1`
    5. `/^Commission #([A-Za-z0-9-]+)\s+completed/i` → `COMMISSION_COMPLETED`, `commissionId = $1`
    6. otherwise → `UNKNOWN`, both ids `null` (never `null` return — an unrecognised VGen email must still be stored)
  - `receivedAt`: `new Date(email.date)`, falling back to `new Date()` when the header is unparseable (ingestion time, not a fabricated send time). `subject` is trimmed; `from` is passed through as received.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gmail/tests/parser.test.ts
import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { isVGenSender, parseVGenEmail } from '../src/parser';

const email = (subject: string, overrides: Partial<{ id: string; from: string; date: string }> = {}) => ({
  id: 'msg-1',
  subject,
  from: 'VGen <no-reply@vgen.co>',
  date: '2026-10-16T14:32:11.000Z',
  ...overrides,
});

describe('VGen email parser', () => {
  it('parses a new message notification with the client username', () => {
    const parsed = parseVGenEmail(email('@ErianOsamu sent you a new message!'));
    expect(parsed).toMatchObject({
      source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE,
      externalId: 'msg-1', clientUsername: 'ErianOsamu', commissionId: null,
    });
    expect(parsed!.receivedAt.toISOString()).toBe('2026-10-16T14:32:11.000Z');
  });

  it('parses a new commission request with the client username', () => {
    const parsed = parseVGenEmail(email('New commission request from @ErianOsamu'));
    expect(parsed!.eventType).toBe(VGenEventType.NEW_COMMISSION);
    expect(parsed!.clientUsername).toBe('ErianOsamu');
  });

  it('parses commission status emails with the commission id', () => {
    expect(parseVGenEmail(email('Commission #VG-1234 updated')))
      .toMatchObject({ eventType: VGenEventType.COMMISSION_UPDATED, commissionId: 'VG-1234', clientUsername: null });
    expect(parseVGenEmail(email('Commission #VG-1234 confirmed'))!.eventType).toBe(VGenEventType.COMMISSION_CONFIRMED);
    expect(parseVGenEmail(email('Commission #VG-1234 completed'))!.eventType).toBe(VGenEventType.COMMISSION_COMPLETED);
  });

  it('keeps an unrecognised VGen subject as unknown instead of dropping it', () => {
    const parsed = parseVGenEmail(email('Your VGen weekly digest'));
    expect(parsed).not.toBeNull();
    expect(parsed!.eventType).toBe(VGenEventType.UNKNOWN);
    expect(parsed!.clientUsername).toBeNull();
  });

  it('ignores non-VGen senders and spoofed domains', () => {
    expect(parseVGenEmail(email('@ErianOsamu sent you a new message!', { from: 'someone@gmail.com' }))).toBeNull();
    expect(parseVGenEmail(email('@ErianOsamu sent you a new message!', { from: 'no-reply@vgen.co.evil.com' }))).toBeNull();
    expect(isVGenSender('no-reply@vgen.co')).toBeTrue();
    expect(isVGenSender('VGen <hello@VGEN.CO>')).toBeTrue();
    expect(isVGenSender('noreply@vgen.co.evil.com')).toBeFalse();
  });

  it('ignores an email with no message id', () => {
    expect(parseVGenEmail(email('@ErianOsamu sent you a new message!', { id: '' }))).toBeNull();
  });

  it('falls back to ingestion time when the Date header is unparseable', () => {
    const before = Date.now();
    const parsed = parseVGenEmail(email('@ErianOsamu sent you a new message!', { date: 'not-a-date' }));
    expect(parsed!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gmail/tests/parser.test.ts`
Expected: FAIL — cannot resolve `../src/parser`.

- [ ] **Step 3: Create the package (`@client-agent/gmail`, `main`/`types` → `./src/index.ts`, dependency `@client-agent/domain` only), implement `parser.ts`, add the tsconfig path aliases, then `bun install`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gmail/tests/parser.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/gmail/package.json packages/gmail/src packages/gmail/tests/parser.test.ts tsconfig.json bun.lock
git commit -m "feat(gmail): add VGen notification email parser"
```

---

### Task 6: Gmail REST client and OAuth refresh in `packages/gmail`

**Files:**
- Create: `packages/gmail/src/types.ts`, `packages/gmail/src/client.ts`
- Modify: `packages/gmail/src/index.ts`
- Test: `packages/gmail/tests/client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface GmailMessage { id: string; threadId: string; subject: string; from: string; date: string }`
  - `interface GoogleOAuthCredentials { clientId: string; clientSecret: string; refreshToken: string }`
  - `interface GmailProfile { emailAddress: string; historyId: string }`
  - `interface GmailClient { getProfile(): Promise<GmailProfile>; fetchMessageById(messageId: string): Promise<GmailMessage>; listHistory(startHistoryId: string): Promise<{ messageIds: string[]; latestHistoryId: string }> }`
  - `class GmailApiError extends Error { constructor(public status: number, message: string) }`
  - `class GmailHistoryExpiredError extends Error`
  - `createGmailClient(options: { credentials: GoogleOAuthCredentials; fetchImpl?: typeof fetch }): GmailClient`
  - `refreshAccessToken(credentials: GoogleOAuthCredentials, fetchImpl?: typeof fetch): Promise<{ accessToken: string; expiresAt: Date }>`
  - `extractHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string` (case-insensitive, `''` when absent)
  - Endpoints: API base `https://gmail.googleapis.com/gmail/v1`, token URL `https://oauth2.googleapis.com/token`.
  - `refreshAccessToken` POSTs `application/x-www-form-urlencoded` `grant_type=refresh_token&client_id=…&client_secret=…&refresh_token=…`; non-2xx → `GmailApiError`.
  - The client caches the access token in its closure and refreshes when it expires within 60 s. A `401` invalidates the cache and retries the request exactly once.
  - `fetchMessageById` → `GET /users/me/messages/{id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, mapped through `extractHeader`.
  - `listHistory` → `GET /users/me/history?startHistoryId={id}&historyTypes=messageAdded`; `404` → `GmailHistoryExpiredError`; message ids are flattened from `history[].messagesAdded[].message.id`, de-duplicated, order preserved; `latestHistoryId` = response `historyId` ?? `startHistoryId`.
  - `getProfile` → `GET /users/me/profile` → `{ emailAddress, historyId }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gmail/tests/client.test.ts
import { describe, expect, it } from 'bun:test';
import { GmailApiError, GmailHistoryExpiredError, createGmailClient, extractHeader } from '../src/client';

const credentials = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' };

function stubFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler!(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const tokenResponse = () => new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 });

describe('Gmail REST client', () => {
  it('extracts headers case-insensitively and tolerates missing ones', () => {
    expect(extractHeader([{ name: 'subject', value: 'Hi' }], 'Subject')).toBe('Hi');
    expect(extractHeader(undefined, 'From')).toBe('');
  });

  it('refreshes once and reuses the access token across calls', async () => {
    const { fetchImpl, calls } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({ emailAddress: 'me@example.com', historyId: '1000' }), { status: 200 }),
      () => new Response(JSON.stringify({ emailAddress: 'me@example.com', historyId: '1000' }), { status: 200 }),
    ]);
    const client = createGmailClient({ credentials, fetchImpl });
    expect(await client.getProfile()).toEqual({ emailAddress: 'me@example.com', historyId: '1000' });
    await client.getProfile();
    expect(calls.filter((url) => url.includes('oauth2.googleapis.com')).length).toBe(1);
    expect(calls.filter((url) => url.includes('/users/me/profile')).length).toBe(2);
  });

  it('maps a message payload to plain subject/from/date fields', async () => {
    const { fetchImpl, calls } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({
        id: 'msg-1', threadId: 'th-1',
        payload: { headers: [
          { name: 'Subject', value: '@ErianOsamu sent you a new message!' },
          { name: 'From', value: 'VGen <no-reply@vgen.co>' },
          { name: 'Date', value: 'Thu, 16 Oct 2026 14:32:11 +0000' },
        ] },
      }), { status: 200 }),
    ]);
    const message = await createGmailClient({ credentials, fetchImpl }).fetchMessageById('msg-1');
    expect(message).toEqual({ id: 'msg-1', threadId: 'th-1', subject: '@ErianOsamu sent you a new message!', from: 'VGen <no-reply@vgen.co>', date: 'Thu, 16 Oct 2026 14:32:11 +0000' });
    const requestUrl = calls[1]!;
    expect(requestUrl).toContain('/users/me/messages/msg-1');
    expect(requestUrl).toContain('format=metadata');
    expect(requestUrl).toContain('metadataHeaders=Subject');
  });

  it('flattens and de-duplicates added messages from history', async () => {
    const { fetchImpl } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({
        historyId: '1010',
        history: [
          { messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'b' } }] },
          { messagesAdded: [{ message: { id: 'b' } }] },
        ],
      }), { status: 200 }),
    ]);
    const history = await createGmailClient({ credentials, fetchImpl }).listHistory('1000');
    expect(history.messageIds).toEqual(['a', 'b']);
    expect(history.latestHistoryId).toBe('1010');
  });

  it('maps a 404 on history to GmailHistoryExpiredError', async () => {
    const { fetchImpl } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({ error: { message: 'historyId too old' } }), { status: 404 }),
    ]);
    expect(await createGmailClient({ credentials, fetchImpl }).listHistory('1')).rejects.toBeInstanceOf(GmailHistoryExpiredError);
  });

  it('retries once with a fresh token after a 401', async () => {
    const { fetchImpl, calls } = stubFetch([
      tokenResponse,
      () => new Response('unauthorized', { status: 401 }),
      tokenResponse,
      () => new Response(JSON.stringify({ emailAddress: 'me@example.com', historyId: '2' }), { status: 200 }),
    ]);
    const client = createGmailClient({ credentials, fetchImpl });
    expect((await client.getProfile()).historyId).toBe('2');
    expect(calls.filter((url) => url.includes('oauth2.googleapis.com')).length).toBe(2);
  });

  it('throws GmailApiError with the upstream status', async () => {
    const { fetchImpl } = stubFetch([
      () => new Response('invalid_grant', { status: 400 }),
    ]);
    await expect(createGmailClient({ credentials, fetchImpl }).getProfile()).rejects.toBeInstanceOf(GmailApiError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gmail/tests/client.test.ts`
Expected: FAIL — cannot resolve `../src/client`.

- [ ] **Step 3: Implement `types.ts` and `client.ts`, export from `src/index.ts`**

Keep the refresh/401-retry logic inside a single `authorizedFetch(path)` closure so both caching and retry live in one place.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gmail/tests/client.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/gmail/src packages/gmail/tests/client.test.ts
git commit -m "feat(gmail): add Gmail REST client with OAuth token refresh and retry"
```

---

### Task 7: Pub/Sub push decoding and OIDC verification in `packages/gmail`

**Files:**
- Create: `packages/gmail/src/pubsub.ts`
- Modify: `packages/gmail/src/index.ts`
- Test: `packages/gmail/tests/pubsub.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface PubSubPushBody { message: { data: string; messageId?: string; publishTime?: string }; subscription?: string }`
  - `interface GmailPushNotification { emailAddress: string; historyId: string }`
  - `class PubSubPayloadError extends Error`
  - `class PubSubAuthError extends Error`
  - `decodePubSubData(body: PubSubPushBody): Record<string, unknown>` — standard (and base64url) base64 → UTF-8 → `JSON.parse`; invalid base64, invalid JSON, or a non-object all throw `PubSubPayloadError`.
  - `parseGmailPushNotification(body: PubSubPushBody): GmailPushNotification` — `emailAddress` and `historyId` are coerced from string or number; missing/empty either → `PubSubPayloadError`.
  - `verifyPubSubPushToken(options: { token: string; audience: string; fetchImpl?: typeof fetch; now?: () => number; jwksUrl?: string; toleranceSeconds?: number }): Promise<{ email: string }>` — RS256 JWT verified with Web Crypto against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`, cached in module scope for 1 h). Rejects with `PubSubAuthError` when: header `alg !== 'RS256'`, `kid` unknown, signature invalid, `iss` not in `['accounts.google.com', 'https://accounts.google.com']`, `aud !== audience`, `exp <= now`, or `iat > now + toleranceSeconds` (default 60). `jwksUrl` and `fetchImpl` are the injection points for tests. The 1 h JWKS cache must be keyed by `jwksUrl` and skipped entirely when `fetchImpl` is supplied, so one test can never read another's keys.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gmail/tests/pubsub.test.ts
import { describe, expect, it, beforeAll } from 'bun:test';
import { PubSubAuthError, PubSubPayloadError, decodePubSubData, parseGmailPushNotification, verifyPubSubPushToken } from '../src/pubsub';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const push = (payload: unknown) => ({ message: { data: b64(JSON.stringify(payload)) } });

let privateKey: CryptoKey;
let jwksFetch: typeof fetch;
const audience = 'https://agent.example.com/api/v1/webhooks/google/gmail';

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwksFetch = (async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] }), { status: 200 })) as typeof fetch;
});

async function signToken(claims: Record<string, unknown>) {
  const header = b64url({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' });
  const payload = b64url(claims);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}

const claims = () => ({ iss: 'https://accounts.google.com', aud: audience, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email: 'pubsub@project.iam.gserviceaccount.com' });

describe('Pub/Sub push handling', () => {
  it('decodes a base64 payload', () => {
    expect(decodePubSubData(push({ emailAddress: 'me@example.com', historyId: '12345' }))).toEqual({ emailAddress: 'me@example.com', historyId: '12345' });
  });

  it('rejects malformed payloads', () => {
    expect(() => decodePubSubData({ message: { data: 'not-base64-json' } })).toThrow(PubSubPayloadError);
    expect(() => parseGmailPushNotification(push({ emailAddress: 'me@example.com' }))).toThrow(PubSubPayloadError);
  });

  it('parses email address and history id as strings', () => {
    expect(parseGmailPushNotification(push({ emailAddress: 'me@example.com', historyId: 12345 }))).toEqual({ emailAddress: 'me@example.com', historyId: '12345' });
  });

  it('accepts a well-formed token from Google', async () => {
    const token = await signToken(claims());
    expect((await verifyPubSubPushToken({ token, audience, fetchImpl: jwksFetch })).email).toBe('pubsub@project.iam.gserviceaccount.com');
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signToken({ ...claims(), aud: 'https://evil.example.com' });
    await expect(verifyPubSubPushToken({ token, audience, fetchImpl: jwksFetch })).rejects.toBeInstanceOf(PubSubAuthError);
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await signToken({ ...claims(), exp: past, iat: past - 10 });
    await expect(verifyPubSubPushToken({ token, audience, fetchImpl: jwksFetch })).rejects.toBeInstanceOf(PubSubAuthError);
  });

  it('rejects a tampered signature', async () => {
    const token = await signToken(claims());
    const parts = token.split('.');
    const token2 = `${parts[0]}.${parts[1]}.${Buffer.from('forged').toString('base64url')}`;
    await expect(verifyPubSubPushToken({ token: token2, audience, fetchImpl: jwksFetch })).rejects.toBeInstanceOf(PubSubAuthError);
  });
});
```

`push()` already satisfies `PubSubPushBody`, so no casts are needed. `b64url` also unifies single- and multi-byte input by always stringifying.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gmail/tests/pubsub.test.ts`
Expected: FAIL — cannot resolve `../src/pubsub`.

- [ ] **Step 3: Implement `pubsub.ts` (Web Crypto only, no new dependency) and export from `src/index.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gmail/tests/pubsub.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/gmail/src packages/gmail/tests/pubsub.test.ts
git commit -m "feat(gmail): verify Pub/Sub push tokens and decode Gmail notifications"
```

---

### Task 8: Gmail webhook endpoint in `apps/api`

**Files:**
- Create: `apps/api/src/routes/webhooks/gmail.ts`, `apps/api/src/services/gmail.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/package.json`
- Test: `apps/api/tests/webhook-gmail.test.ts`

**Interfaces:**
- Consumes: `GmailClient`, `GmailHistoryExpiredError`, `GmailApiError`, `parseGmailPushNotification`, `verifyPubSubPushToken`, `parseVGenEmail` from `@client-agent/gmail`; `insertEventIfNew`, `createTask`, `getOwnerUserId`, `getIntegration`, `upsertIntegration` from `@client-agent/db`; `publishTask`, `STREAMS` from `@client-agent/queue`; `TaskType` from `@client-agent/domain`.
- Produces:
  - `interface GmailWebhookDeps { resolveGmailClient: () => Promise<GmailClient | null> }` and `createGmailWebhookRoutes(deps: GmailWebhookDeps): Elysia`.
  - `apps/api/src/services/gmail.ts` exports `GoogleNotConfiguredError` and `resolveGmailClient(): Promise<GmailClient | null>`: `getOwnerUserId()` → `getIntegration(userId, 'gmail')`; returns `null` when the row is missing/not `connected` or `row.credentialsEncrypted` is null; otherwise `JSON.parse(await decryptSecret(row.credentialsEncrypted, config.AUTH_SECRET))` for `{ refreshToken }` and `createGmailClient({ credentials: { refreshToken, clientId: config.GOOGLE_CLIENT_ID!, clientSecret: config.GOOGLE_CLIENT_SECRET! } })`. Only the refresh token is sealed at rest; the client id/secret stay in the environment.
  - Route `POST /api/v1/webhooks/google/gmail` (no `isAuth` — the app has no global guard, so nothing to opt out of). Behaviour:
    1. If `config.GOOGLE_PUBSUB_AUDIENCE` is set, read `authorization`, require a `Bearer <token>` → `verifyPubSubPushToken`; failure → 401 `{ error: { code: 'UNAUTHORIZED' } }`. If unset (local dev), skip verification and log a warning.
    2. `parseGmailPushNotification(body)`; `PubSubPayloadError` → 400 `{ error: { code: 'INVALID_PUBSUB_PAYLOAD' } }`.
    3. `getOwnerUserId()` → `getIntegration(userId, 'gmail')`; missing or not `connected` → 200 `{ ok: false, reason: 'gmail_not_connected' }`.
    4. `const client = await deps.resolveGmailClient()`; `null` → same 200 body.
    5. `storedHistoryId = integration.metadata.lastHistoryId` (string). If absent → `client.getProfile()`, persist `{ emailAddress, lastHistoryId: profile.historyId }` into the integration metadata, return 200 `{ ok: true, bootstrapped: true }`.
    6. `listHistory(storedHistoryId)` → `GmailHistoryExpiredError` → re-bootstrap (same as 5) and return 200 `{ ok: true, bootstrapped: true }`. `GmailApiError` raised by either step 5 or step 6 → `upsertIntegration({ userId, provider: 'gmail', status: 'error', metadata: integration.metadata, credentialsEncrypted: integration.credentialsEncrypted })` and return 200 `{ ok: false, reason: 'gmail_api_error' }` (never 5xx — a Pub/Sub retry storm solves nothing).
    7. For the first 25 ids (`MAX_MESSAGES_PER_PUSH = 25`): `fetchMessageById` → `parseVGenEmail` → skip `null`; `insertEventIfNew({ source: 'gmail', provider: 'vgen', eventType: parsed.eventType, externalId: parsed.externalId, receivedAt: parsed.receivedAt, payload: { subject, from, date: parsed.receivedAt.toISOString(), clientUsername, commissionId, historyId: push.historyId } })`; when a row comes back, `createTask({ userId, eventId: row.id, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: row.id }, idempotencyKey: `gmail_event:${row.id}:process` })` then `publishTask(STREAMS.EVENTS, { type: TaskType.PROCESS_GMAIL_EVENT, taskId: String(task.id) })`.
    8. Persist `lastHistoryId = push.historyId` into the integration metadata; return 200 `{ ok: true, events: <inserted count> }`.
  - A per-message `GmailApiError` is caught inside the loop and logged; remaining messages are still processed.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/webhook-gmail.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, events, agentTasks, integrations, getOwnerUserId, upsertIntegration, deleteIntegration } from '@client-agent/db';
import { TaskType, VGenEventType } from '@client-agent/domain';
import { GmailApiError, GmailHistoryExpiredError, type GmailClient } from '@client-agent/gmail';
import { createGmailWebhookRoutes } from '../src/routes/webhooks/gmail';

const ownerId = await getOwnerUserId();
const externalId = `wh-${Date.now()}`;
const historyId = '5000';
const pushBody = (id: string) => ({
  message: { data: Buffer.from(JSON.stringify({ emailAddress: 'me@example.com', historyId: id })).toString('base64') },
});

function fakeClient(overrides: Partial<GmailClient> = {}): GmailClient {
  return {
    getProfile: async () => ({ emailAddress: 'me@example.com', historyId: '4000' }),
    listHistory: async () => ({ messageIds: [externalId], latestHistoryId: historyId }),
    fetchMessageById: async (id) => ({
      id, threadId: 'th', subject: '@ErianOsamu sent you a new message!',
      from: 'VGen <no-reply@vgen.co>', date: '2026-10-16T14:32:11.000Z',
    }),
    ...overrides,
  };
}

const appWith = (client: GmailClient) => new Elysia().use(createGmailWebhookRoutes({ resolveGmailClient: async () => client }));

const post = (app: Elysia, body: unknown) => app.handle(new Request('http://localhost/api/v1/webhooks/google/gmail', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

afterAll(async () => {
  await db.delete(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${externalId}:process`));
  await db.delete(events).where(eq(events.externalId, externalId));
  await deleteIntegration(ownerId, 'gmail');
});

describe('POST /api/v1/webhooks/google/gmail', () => {
  it('creates exactly one event and one task when the same push arrives twice', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });
    const app = appWith(fakeClient());
    expect((await post(app, pushBody(historyId))).status).toBe(200);
    expect((await post(app, pushBody(historyId))).status).toBe(200);
    const rows = await db.select().from(events).where(eq(events.externalId, externalId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe(VGenEventType.NEW_MESSAGE);
    expect(rows[0]!.payload).toMatchObject({ clientUsername: 'ErianOsamu' });
    const tasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${rows[0]!.id}:process`));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe(TaskType.PROCESS_GMAIL_EVENT);
  });

  it('returns 400 for a malformed Pub/Sub envelope', async () => {
    const res = await post(appWith(fakeClient()), { message: { data: 'nope' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_PUBSUB_PAYLOAD');
  });

  it('bootstraps the history id when the integration has none', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: {} });
    const res = await post(appWith(fakeClient()), pushBody(historyId));
    expect(await res.json()).toEqual({ ok: true, bootstrapped: true });
  });

  it('re-bootstraps when the stored history id has expired', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: '1' } });
    const client = fakeClient({ listHistory: async () => { throw new GmailHistoryExpiredError('too old'); } });
    expect(await (await post(appWith(client), pushBody(historyId))).json()).toEqual({ ok: true, bootstrapped: true });
  });

  it('answers 200 and marks the integration on a revoked credential', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });
    const client = fakeClient({ listHistory: async () => { throw new GmailApiError(401, 'invalid_grant'); } });
    const res = await post(appWith(client), pushBody(historyId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'gmail_api_error' });
    expect((await db.select().from(integrations).where(eq(integrations.provider, 'gmail')))[0]!.status).toBe('error');
  });

  it('reports gmail_not_connected instead of failing when no integration exists', async () => {
    await deleteIntegration(ownerId, 'gmail');
    expect(await (await post(appWith(fakeClient()), pushBody(historyId))).json()).toEqual({ ok: false, reason: 'gmail_not_connected' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/webhook-gmail.test.ts`
Expected: FAIL — cannot resolve `../src/routes/webhooks/gmail`.

- [ ] **Step 3: Implement `services/gmail.ts` and `routes/webhooks/gmail.ts`; mount with `.use(createGmailWebhookRoutes({ resolveGmailClient }))` in `apps/api/src/app.ts`; add `@client-agent/gmail` to `apps/api/package.json` and run `bun install`**

Add `MAX_MESSAGES_PER_PUSH = 25` as a module constant.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/webhook-gmail.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/tests/webhook-gmail.test.ts apps/api/package.json bun.lock
git commit -m "feat(api): add Gmail Pub/Sub webhook with dedup, bootstrap, and credential failure handling"
```

---

### Task 9: Discord notifier in `packages/discord`

**Files:**
- Create: `packages/discord/package.json`, `packages/discord/src/index.ts`, `packages/discord/src/notifications.ts`, `packages/discord/src/client.ts`
- Modify: `tsconfig.json` (add `@client-agent/discord` / `@client-agent/discord/*` path aliases)
- Test: `packages/discord/tests/notifications.test.ts`, `packages/discord/tests/client.test.ts`

**Interfaces:**
- Consumes: `VGenEventType` from `@client-agent/domain`.
- Produces (pure formatting lives in `notifications.ts`, network calls in `client.ts`):
  - `interface DiscordEventNotification { eventType: VGenEventType; clientUsername: string | null; commissionId: string | null; subject: string; receivedAt: Date }`
  - `formatUtcMinute(date: Date): string` → `2026-10-16 14:32 UTC` from `toISOString()` (always UTC, no locale).
  - `formatEventNotification(event: DiscordEventNotification): string` — exact template:
    ```
    🔔 <Event Label>

    Client: @<username>
    Event: <Event Label>
    Received: <formatUtcMinute(receivedAt)>

    The notification email does not contain the conversation content.
    ```
    Label map: `new_message → New VGen Message`, `new_commission → New Commission Request`, `commission_confirmed → Commission Confirmed`, `commission_updated → Commission Updated`, `commission_completed → Commission Completed`, `unknown → Unknown VGen Event`. When `clientUsername` is `null` the line is `Client: unknown`; when `commissionId` is set an extra `Commission: <id>` line follows `Client:`. No message body is ever included.
  - `interface DiscordRestLike { post(route: string, options: { body: unknown }): Promise<unknown>; get(route: string): Promise<unknown> }`
  - `interface DiscordNotifier { sendEventNotification(channelId: string, event: DiscordEventNotification): Promise<{ messageId: string }>; verifyChannel(channelId: string): Promise<{ id: string; name: string }> }`
  - `createDiscordNotifier(options: { token: string; rest?: DiscordRestLike }): DiscordNotifier` — the default `rest` is `new REST({ version: '10' }).setToken(options.token)` from `discord.js`; `sendEventNotification` posts to `/channels/{channelId}/messages` with `{ body: { content } }` and returns `{ messageId: String(response.id) }`; `verifyChannel` gets `/channels/{channelId}`.
  - Phase 1 is REST-only: no Gateway socket, no slash commands (they arrive with the VGen reader phase).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/discord/tests/notifications.test.ts
import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { formatEventNotification, formatUtcMinute } from '../src/notifications';

describe('Discord notification formatting', () => {
  it('formats a new message notification', () => {
    const text = formatEventNotification({
      eventType: VGenEventType.NEW_MESSAGE, clientUsername: 'ErianOsamu', commissionId: null,
      subject: '@ErianOsamu sent you a new message!', receivedAt: new Date('2026-10-16T14:32:11.000Z'),
    });
    expect(text).toContain('🔔 New VGen Message');
    expect(text).toContain('Client: @ErianOsamu');
    expect(text).toContain('Event: New VGen Message');
    expect(text).toContain('Received: 2026-10-16 14:32 UTC');
    expect(text).toContain('The notification email does not contain the conversation content.');
  });

  it('adds the commission line and unknown client for commission events', () => {
    const text = formatEventNotification({
      eventType: VGenEventType.COMMISSION_UPDATED, clientUsername: null, commissionId: 'VG-1234',
      subject: 'Commission #VG-1234 updated', receivedAt: new Date('2026-10-16T00:05:00.000Z'),
    });
    expect(text).toContain('Event: Commission Updated');
    expect(text).toContain('Client: unknown');
    expect(text).toContain('Commission: VG-1234');
    expect(text).toContain('Received: 2026-10-16 00:05 UTC');
  });

  it('labels unknown VGen events without pretending to know them', () => {
    const text = formatEventNotification({
      eventType: VGenEventType.UNKNOWN, clientUsername: null, commissionId: null,
      subject: 'Your VGen weekly digest', receivedAt: new Date('2026-10-16T09:00:00.000Z'),
    });
    expect(text).toContain('Unknown VGen Event');
  });

  it('formats to the minute in UTC', () => {
    expect(formatUtcMinute(new Date('2026-01-02T03:04:59.999Z'))).toBe('2026-01-02 03:04 UTC');
  });
});
```

```ts
// packages/discord/tests/client.test.ts
import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { createDiscordNotifier, type DiscordRestLike } from '../src/client';

function stubRest() {
  const calls: Array<{ method: 'post' | 'get'; route: string; body?: unknown }> = [];
  const rest: DiscordRestLike = {
    post: async (route, options) => { calls.push({ method: 'post', route, body: options.body }); return { id: 'msg-99' }; },
    get: async (route) => { calls.push({ method: 'get', route }); return { id: 'chan-1', name: 'vgen-alerts' }; },
  };
  return { rest, calls };
}

const event = {
  eventType: VGenEventType.NEW_MESSAGE, clientUsername: 'ErianOsamu', commissionId: null,
  subject: '@ErianOsamu sent you a new message!', receivedAt: new Date('2026-10-16T14:32:11.000Z'),
};

describe('Discord notifier', () => {
  it('posts the formatted message to the channel', async () => {
    const { rest, calls } = stubRest();
    const result = await createDiscordNotifier({ token: 't', rest }).sendEventNotification('chan-1', event);
    expect(result.messageId).toBe('msg-99');
    expect(calls[0]!.route).toBe('/channels/chan-1/messages');
    expect((calls[0]!.body as { content: string }).content).toContain('Client: @ErianOsamu');
  });

  it('verifies a channel and surfaces its name', async () => {
    const { rest } = stubRest();
    expect(await createDiscordNotifier({ token: 't', rest }).verifyChannel('chan-1')).toEqual({ id: 'chan-1', name: 'vgen-alerts' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/discord`
Expected: FAIL — `cannot resolve '../src/notifications'` for the formatting suite and `cannot resolve '../src/client'` for the notifier suite.

- [ ] **Step 3: Create the package (`@client-agent/discord`, deps `discord.js` + `@client-agent/domain`), implement `notifications.ts` (pure formatting) and `client.ts` (REST notifier), add tsconfig path aliases, then `bun install`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/discord`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/discord tsconfig.json bun.lock
git commit -m "feat(discord): add REST notifier and VGen notification formatter"
```

---

### Task 10: Worker consumer registry and `PROCESS_GMAIL_EVENT` handler

**Files:**
- Create: `apps/worker/src/handlers/processGmailEvent.ts`, `apps/worker/src/consumers.ts`
- Modify: `apps/worker/src/index.ts`, `apps/worker/package.json` (no new deps expected)
- Test: `apps/worker/tests/processGmailEvent.test.ts`

**Interfaces:**
- Consumes: `getTaskById`, `markTaskRunning`, `markTaskCompleted`, `markTaskFailed`, `getEventById`, `markEventProcessed`, `upsertClient`, `createTask`, `findTaskByIdempotencyKey` from `@client-agent/db`; `TaskStatus`, `TaskType`, `VGenEventPayload` from `@client-agent/domain`; `publishTask`, `STREAMS`, `ParsedTask`.
- Produces:
  - `handleProcessGmailEvent(task: ParsedTask, deps?: { notificationsStream?: string }): Promise<void>`
    1. `taskId = Number(task.data.taskId)`; `Number.isNaN` → throw `Error('PROCESS_GMAIL_EVENT message missing taskId')`.
    2. Load the task row; missing → throw. `status === 'completed'` → return (replay no-op).
    3. `markTaskRunning(id)`.
    4. Load the event by `taskRow.eventId`; missing → `markTaskFailed` then throw.
    5. `payload = event.payload as VGenEventPayload`; when `payload.clientUsername` is a non-empty string → `upsertClient({ userId: taskRow.userId, platform: 'vgen', username: payload.clientUsername })`.
    6. Notify task: `const existing = await findTaskByIdempotencyKey(\`gmail_event:${event.id}:notify\`)`. Reuse it when present, otherwise `createTask({ userId: taskRow.userId, eventId: event.id, type: TaskType.NOTIFY_DISCORD, input: { eventId: event.id }, idempotencyKey: \`gmail_event:${event.id}:notify\` })`.
    7. Publish **only** when the notify task was just created, or when the existing task's `status !== TaskStatus.COMPLETED`: `publishTask(deps?.notificationsStream ?? STREAMS.NOTIFICATIONS, { type: TaskType.NOTIFY_DISCORD, taskId: String(notifyTask.id) })`. A reused task that already completed has been delivered; re-publishing it burns a consumer round-trip for a handler that will no-op.
    8. `markEventProcessed(event.id)`; `markTaskCompleted(id, { eventId: event.id, notifyTaskId: notifyTask.id })`.
    9. Any thrown error before completion: `markTaskFailed(id, message)` then rethrow (Phase 2 adds retries; `handleTask` only acks on success, so an unacked message is redelivered).
  - `interface WorkerConsumer { stream: string; handler: (task: ParsedTask, redis: Redis) => Promise<void> }` and `startWorker(options: { workerId: string; group: string; consumers: WorkerConsumer[]; redis: Redis }): Promise<{ shutdown: () => Promise<void> }>` — one independent `while` loop per consumer (a blocked stream must not stall the other), each calling `handleTask`, logging `[worker] <stream> <entryId>` on success; heartbeat every 30 s moves into `startWorker`.
  - `apps/worker/src/index.ts` becomes: build redis → `startWorker({ workerId: WORKER_ID, group: 'client_agent_workers', redis, consumers: [ { stream: STREAMS.EVENTS, handler: handleProcessGmailEvent }, { stream: STREAMS.NOTIFICATIONS, handler: (task) => handleNotifyDiscord(task, discordDeps) } ] })` (the notifications consumer is finished in Task 11) → wire SIGTERM/SIGINT to `shutdown()`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/tests/processGmailEvent.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db, events, agentTasks, clients, getOwnerUserId,
  insertEventIfNew, createTask, getTaskById, getEventById,
} from '@client-agent/db';
import { TaskStatus, TaskType, VGenEventType } from '@client-agent/domain';
import { STREAMS, createRedisClient } from '@client-agent/queue';
import { handleProcessGmailEvent } from '../src/handlers/processGmailEvent';

const externalId = `worker-${Date.now()}`;
const username = `WorkerUser${Date.now()}`;
const notificationsStream = `${STREAMS.NOTIFICATIONS}_test_${Date.now()}`;
const redis = createRedisClient();
const ownerId = await getOwnerUserId();
const createdEventIds: number[] = [];
const createdTaskIds: number[] = [];

// Reads a Redis stream field list into a plain record so assertions do not depend on key order.
function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) record[fields[i]!] = fields[i + 1]!;
  return record;
}

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(agentTasks).where(eq(agentTasks.id, id));
  for (const id of createdEventIds) await db.delete(events).where(eq(events.id, id));
  await db.delete(clients).where(eq(clients.username, username));
  await redis.del(notificationsStream);
  redis.disconnect();
});

async function seed() {
  const event = (await insertEventIfNew({
    source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE, externalId: `${externalId}-${createdEventIds.length}`,
    payload: { subject: 's', from: 'f', date: 'd', clientUsername: username, commissionId: null, historyId: '1' },
    receivedAt: new Date(),
  }))!;
  createdEventIds.push(event.id);
  const task = await createTask({ userId: ownerId, eventId: event.id, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: event.id }, idempotencyKey: `gmail_event:${event.id}:process` });
  createdTaskIds.push(task.id);
  return { event, task };
}

describe('PROCESS_GMAIL_EVENT handler', () => {
  it('upserts the client, enqueues exactly one NOTIFY_DISCORD task, and marks the event processed', async () => {
    const { event, task } = await seed();
    await handleProcessGmailEvent({ id: '1-0', data: { taskId: String(task.id), type: TaskType.PROCESS_GMAIL_EVENT } }, { notificationsStream });

    const client = (await db.select().from(clients).where(eq(clients.username, username)))[0]!;
    expect(client.platform).toBe('vgen');

    const notifyKey = `gmail_event:${event.id}:notify`;
    const notifyTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, notifyKey));
    expect(notifyTasks).toHaveLength(1);
    expect(notifyTasks[0]!.type).toBe(TaskType.NOTIFY_DISCORD);
    createdTaskIds.push(notifyTasks[0]!.id);

    const entries = await redis.xrange(notificationsStream, '-', '+');
    expect(entries).toHaveLength(1);
    const record = fieldsToRecord(entries[0]![1] as string[]);
    expect(record.type).toBe(TaskType.NOTIFY_DISCORD);
    expect(record.taskId).toBe(String(notifyTasks[0]!.id));

    expect((await getEventById(event.id))!.status as string).toBe('processed');
    expect((await getTaskById(task.id))!.status).toBe(TaskStatus.COMPLETED);
  });

  it('does not duplicate the notify task when the same event is processed again', async () => {
    const { event, task } = await seed();
    await handleProcessGmailEvent({ id: '1-1', data: { taskId: String(task.id) } }, { notificationsStream });

    // A second, distinct process task for the same event must reuse the notify task found by idempotency key.
    const secondProcess = await createTask({
      userId: ownerId, eventId: event.id, type: TaskType.PROCESS_GMAIL_EVENT,
      input: { eventId: event.id }, idempotencyKey: `gmail_event:${event.id}:process:second`,
    });
    createdTaskIds.push(secondProcess.id);
    await handleProcessGmailEvent({ id: '1-2', data: { taskId: String(secondProcess.id) } }, { notificationsStream });

    // A redelivery of an already completed task is a no-op.
    await handleProcessGmailEvent({ id: '1-3', data: { taskId: String(task.id) } }, { notificationsStream });

    const notifyTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${event.id}:notify`));
    expect(notifyTasks).toHaveLength(1);
    createdTaskIds.push(notifyTasks[0]!.id);
    expect((await db.select().from(clients).where(eq(clients.username, username)))).toHaveLength(1);
    expect((await redis.xrange(notificationsStream, '-', '+'))).toHaveLength(2);
  });

  it('marks the task failed when the event row is missing', async () => {
    const task = await createTask({ userId: ownerId, type: TaskType.PROCESS_GMAIL_EVENT, input: { eventId: 999999 }, idempotencyKey: `missing-event-${externalId}` });
    createdTaskIds.push(task.id);
    await expect(handleProcessGmailEvent({ id: '2-0', data: { taskId: String(task.id) } }, { notificationsStream })).rejects.toThrow();
    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.FAILED);
    expect(row!.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/processGmailEvent.test.ts`
Expected: FAIL — cannot resolve `../src/handlers/processGmailEvent`.

- [ ] **Step 3: Implement `handlers/processGmailEvent.ts` and `consumers.ts`; rewrite `apps/worker/src/index.ts` to use `startWorker`**

Keep `apps/worker/src/taskHandler.ts` as-is (it is the ack boundary) and keep the existing `formatHeartbeat` export — `apps/worker/tests/worker.test.ts` must keep passing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/worker`
Expected: PASS — `worker.test.ts` (2 tests) plus `processGmailEvent.test.ts` (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src apps/worker/tests/processGmailEvent.test.ts
git commit -m "feat(worker): add consumer registry and PROCESS_GMAIL_EVENT handler"
```

---

### Task 11: `NOTIFY_DISCORD` handler

**Files:**
- Create: `apps/worker/src/handlers/notifyDiscord.ts`, `apps/worker/src/services/discord.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/tests/notifyDiscord.test.ts`

**Interfaces:**
- Consumes: `DiscordNotifier`, `createDiscordNotifier` from `@client-agent/discord`; `getTaskById`, `markTaskRunning`, `markTaskCompleted`, `markTaskFailed`, `getEventById`, `getOwnerUserId`, `getIntegration` from `@client-agent/db`; `VGenEventPayload` from `@client-agent/domain`.
- Produces:
  - `handleNotifyDiscord(task: ParsedTask, deps: { notifier: DiscordNotifier; channelId: string }): Promise<void>` — same guards as Task 10 (missing `taskId` → throw, `completed` → return, `markTaskRunning`); loads the event, builds `DiscordEventNotification` from `event.payload` (`eventType: event.eventType`, `clientUsername`, `commissionId`, `subject`, `receivedAt: event.receivedAt`), calls `deps.notifier.sendEventNotification(deps.channelId, notification)`, then `markTaskCompleted(id, { messageId })`. On a notifier throw: `markTaskFailed(id, message)` then rethrow so the stream entry stays unacked (Phase 2 adds backoff; Phase 1 relies on redelivery).
  - `apps/worker/src/services/discord.ts` → `resolveDiscordNotifier(): Promise<{ notifier: DiscordNotifier; channelId: string } | null>`: requires `config.DISCORD_BOT_TOKEN`; `getOwnerUserId()` → `getIntegration(userId, 'discord')` with `status === 'connected'` and `metadata.channelId` a non-empty string; otherwise `null` (index.ts logs `[worker] Discord integration not configured - NOTIFY_DISCORD tasks will fail`).
  - `apps/worker/src/index.ts` wires the notifications consumer: when `resolveDiscordNotifier()` returns `null`, the handler throws `Error('Discord integration is not configured')`; otherwise it delegates to `handleNotifyDiscord`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/tests/notifyDiscord.test.ts
import { describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, events, agentTasks, getOwnerUserId, insertEventIfNew, createTask, getTaskById } from '@client-agent/db';
import { TaskStatus, TaskType, VGenEventType } from '@client-agent/domain';
import type { DiscordNotifier } from '@client-agent/discord';
import { handleNotifyDiscord } from '../src/handlers/notifyDiscord';

const ownerId = await getOwnerUserId();

async function seed() {
  const externalId = `notify-${Date.now()}-${Math.random()}`;
  const event = (await insertEventIfNew({
    source: 'gmail', provider: 'vgen', eventType: VGenEventType.NEW_MESSAGE, externalId,
    payload: { subject: '@ErianOsamu sent you a new message!', from: 'VGen <no-reply@vgen.co>', date: '2026-10-16T14:32:11.000Z', clientUsername: 'ErianOsamu', commissionId: null, historyId: '1' },
    receivedAt: new Date('2026-10-16T14:32:11.000Z'),
  }))!;
  const task = await createTask({ userId: ownerId, eventId: event.id, type: TaskType.NOTIFY_DISCORD, input: { eventId: event.id }, idempotencyKey: `gmail_event:${event.id}:notify` });
  return { event, task };
}

describe('NOTIFY_DISCORD handler', () => {
  it('sends one notification and stores the message id', async () => {
    const { task } = await seed();
    const sent: unknown[] = [];
    const notifier: DiscordNotifier = {
      sendEventNotification: async (channelId, event) => { sent.push({ channelId, event }); return { messageId: 'msg-42' }; },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    await handleNotifyDiscord({ id: '1-0', data: { taskId: String(task.id) } }, { notifier, channelId: 'chan-1' });
    expect(sent).toHaveLength(1);
    expect((sent[0] as { event: { clientUsername: string } }).event.clientUsername).toBe('ErianOsamu');
    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.COMPLETED);
    expect(row!.output).toEqual({ messageId: 'msg-42' });
  });

  it('records the failure and leaves the task failed when Discord rejects', async () => {
    const { task } = await seed();
    const notifier: DiscordNotifier = {
      sendEventNotification: async () => { throw new Error('Missing Permissions'); },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    expect(handleNotifyDiscord({ id: '1-1', data: { taskId: String(task.id) } }, { notifier, channelId: 'chan-1' })).rejects.toThrow('Missing Permissions');
    const row = await getTaskById(task.id);
    expect(row!.status).toBe(TaskStatus.FAILED);
    expect(row!.error).toContain('Missing Permissions');
  });

  it('is a no-op when the task is already completed', async () => {
    const { task } = await seed();
    let calls = 0;
    const notifier: DiscordNotifier = {
      sendEventNotification: async () => { calls += 1; return { messageId: 'm' }; },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    const deps = { notifier, channelId: 'chan-1' };
    await handleNotifyDiscord({ id: '1-0', data: { taskId: String(task.id) } }, deps);
    await handleNotifyDiscord({ id: '1-1', data: { taskId: String(task.id) } }, deps);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/notifyDiscord.test.ts`
Expected: FAIL — cannot resolve `../src/handlers/notifyDiscord`.

- [ ] **Step 3: Implement `handlers/notifyDiscord.ts` and `services/discord.ts`; wire the notifications consumer in `apps/worker/src/index.ts`; add `@client-agent/discord` to `apps/worker/package.json` then `bun install`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/worker`
Expected: PASS (all worker tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src apps/worker/tests/notifyDiscord.test.ts apps/worker/package.json bun.lock
git commit -m "feat(worker): add NOTIFY_DISCORD handler and Discord integration resolution"
```

---

### Task 12: Integration management API

**Files:**
- Create: `apps/api/src/routes/integrations.ts`, `apps/api/src/services/discord.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/services/gmail.ts` (reuse `createGmailClient` for credential verification), `infrastructure/docker-compose.yml` (pass `GOOGLE_*` and `DISCORD_*` into `api` and `worker`), `.env.example` (only if a key is missing)
- Test: `apps/api/tests/integrations.test.ts`

**Interfaces:**
- Consumes: `createGmailClient`, `GoogleOAuthCredentials` from `@client-agent/gmail`; `createDiscordNotifier` from `@client-agent/discord`; `encryptSecret` from `@client-agent/shared`; `getOwnerUserId`, `getIntegration`, `upsertIntegration`, `deleteIntegration` from `@client-agent/db`; `GoogleNotConfiguredError` from `./services/gmail`; `config`.
- Produces:
  - `class DiscordNotConfiguredError extends Error` in `apps/api/src/services/discord.ts`, mirroring `GoogleNotConfiguredError`.
  - `interface IntegrationDeps { verifyGmailRefreshToken(refreshToken: string): Promise<{ emailAddress: string; historyId: string }>; verifyDiscordChannel(channelId: string): Promise<{ id: string; name: string }> }` with `createIntegrationRoutes(deps: IntegrationDeps): Elysia`, mounted at prefix `/api/v1/integrations`, every route `{ isAuth: true }`. Both verifications are injected so the tests never touch Google or Discord (and never depend on which env keys the test machine happens to have set).
  - `GET /` → `{ data: [<gmail>, <discord>] }` in that fixed order; each entry is `{ provider, status, connected: status === 'connected', metadata }`; a missing row reports `status: 'disconnected'`, `connected: false`, `metadata: {}`. `credentialsEncrypted` is never serialized.
  - `POST /gmail` body `{ refreshToken: string (minLength 1) }` → `deps.verifyGmailRefreshToken(refreshToken)`; `GoogleNotConfiguredError` → 400 `GOOGLE_NOT_CONFIGURED`, any other throw → 400 `GMAIL_AUTH_FAILED` (and nothing is stored); on success `upsertIntegration({ userId, provider: 'gmail', status: 'connected', credentialsEncrypted: await encryptSecret(JSON.stringify({ refreshToken }), config.AUTH_SECRET), metadata: { emailAddress, lastHistoryId: historyId } })` and return `{ data: { provider: 'gmail', status: 'connected', emailAddress } }`.
  - `DELETE /gmail` → `deleteIntegration(userId, 'gmail')`, return `{ data: { provider: 'gmail', status: 'disconnected' } }`.
  - `POST /discord` body `{ channelId: string (minLength 1) }` → `deps.verifyDiscordChannel(channelId)`; `DiscordNotConfiguredError` → 400 `DISCORD_NOT_CONFIGURED`, any other throw → 400 `DISCORD_AUTH_FAILED`; store `metadata: { channelId, channelName }`, `status: 'connected'`; return `{ data: { provider: 'discord', status: 'connected', channelId, channelName } }`.
  - `DELETE /discord` → `deleteIntegration(userId, 'discord')`, return `{ data: { provider: 'discord', status: 'disconnected' } }`.
  - `apps/api/src/services/gmail.ts` gains `verifyGmailRefreshToken(refreshToken: string)` → throws `GoogleNotConfiguredError` when `config.GOOGLE_CLIENT_ID`/`config.GOOGLE_CLIENT_SECRET` are unset, otherwise `createGmailClient({ credentials: { clientId, clientSecret, refreshToken } }).getProfile()`. `apps/api/src/services/discord.ts` gains `verifyDiscordChannel(channelId)` → throws `DiscordNotConfiguredError` when `config.DISCORD_BOT_TOKEN` is unset, otherwise `createDiscordNotifier({ token }).verifyChannel(channelId)`.
  - Telemetry: `upsertIntegration`/`deleteIntegration` changes are logged with `console.info('[integrations] gmail connected')` and the row's `updated_at` is the trail (the `audit_logs` table and its immutable records land with the approval phase).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/integrations.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { config } from '@client-agent/config';
import { getOwnerUserId, getIntegration, deleteIntegration } from '@client-agent/db';
import { app } from '../src/app';
import { createIntegrationRoutes, type IntegrationDeps } from '../src/routes/integrations';

const ownerId = await getOwnerUserId();
const refreshToken = `1//refresh-${Date.now()}`;

const deps: IntegrationDeps = {
  verifyGmailRefreshToken: async (token) => {
    if (token !== refreshToken) throw new Error('invalid_grant');
    return { emailAddress: 'creator@example.com', historyId: '7777' };
  },
  verifyDiscordChannel: async (channelId) => {
    if (channelId !== 'chan-ok') throw new Error('Unknown Channel');
    return { id: channelId, name: 'vgen-alerts' };
  },
};

// isAuth validates the cookie against Redis, so the suite logs in once and reuses the real session.
let sessionCookie = '';
beforeAll(async () => {
  const res = await app.handle(new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.AUTH_USERNAME, password: 'admin123' }),
  }));
  sessionCookie = res.headers.get('set-cookie')!.match(/session=([^;]+)/)![1]!;
});

afterAll(async () => {
  await deleteIntegration(ownerId, 'gmail');
  await deleteIntegration(ownerId, 'discord');
});

const routes = new Elysia().use(createIntegrationRoutes(deps));
const call = (path: string, method = 'GET', body?: unknown) => routes.handle(new Request(`http://localhost/api/v1/integrations${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', Cookie: `session=${sessionCookie}` },
  body: body ? JSON.stringify(body) : undefined,
}));

describe('Integration management API', () => {
  it('requires a session', async () => {
    const res = await routes.handle(new Request('http://localhost/api/v1/integrations'));
    expect(res.status).toBe(401);
  });

  it('reports gmail and discord as disconnected when nothing is configured', async () => {
    const body = await (await call('/', 'GET')).json();
    expect(body.data).toEqual([
      { provider: 'gmail', status: 'disconnected', connected: false, metadata: {} },
      { provider: 'discord', status: 'disconnected', connected: false, metadata: {} },
    ]);
  });

  it('stores gmail credentials sealed and reports the account', async () => {
    const res = await call('/gmail', 'POST', { refreshToken });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ provider: 'gmail', status: 'connected', emailAddress: 'creator@example.com' });
    const row = await getIntegration(ownerId, 'gmail');
    expect(row!.credentialsEncrypted!.startsWith('v1.')).toBeTrue();
    expect(row!.credentialsEncrypted!).not.toContain(refreshToken);
    expect(row!.metadata).toMatchObject({ emailAddress: 'creator@example.com', lastHistoryId: '7777' });
  });

  it('rejects a bad refresh token without storing anything', async () => {
    await deleteIntegration(ownerId, 'gmail');
    const res = await call('/gmail', 'POST', { refreshToken: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('GMAIL_AUTH_FAILED');
    expect(await getIntegration(ownerId, 'gmail')).toBeNull();
  });

  it('never leaks sealed credentials through GET', async () => {
    await call('/gmail', 'POST', { refreshToken });
    expect(JSON.stringify(await (await call('/', 'GET')).json())).not.toContain('v1.');
  });

  it('clears credentials on DELETE', async () => {
    await call('/gmail', 'POST', { refreshToken });
    expect((await call('/gmail', 'DELETE')).status).toBe(200);
    expect(await getIntegration(ownerId, 'gmail')).toBeNull();
  });

  it('verifies a discord channel before storing it', async () => {
    expect((await call('/discord', 'POST', { channelId: 'chan-bad' })).status).toBe(400);
    expect((await call('/discord', 'POST', { channelId: 'chan-bad' })).json()).resolves.toMatchObject({ error: { code: 'DISCORD_AUTH_FAILED' } });
    const res = await call('/discord', 'POST', { channelId: 'chan-ok' });
    expect(res.status).toBe(200);
    expect((await getIntegration(ownerId, 'discord'))!.metadata).toMatchObject({ channelId: 'chan-ok', channelName: 'vgen-alerts' });
    expect((await call('/discord', 'DELETE')).status).toBe(200);
  });
});
```

`beforeAll` needs Postgres and Redis up (the login writes a Redis session). `config.AUTH_USERNAME` plus the fixed dev password `admin123` is the same pair `apps/api/tests/api.test.ts` already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/integrations.test.ts`
Expected: FAIL — cannot resolve `../src/routes/integrations`.

- [ ] **Step 3: Implement `routes/integrations.ts` and the two services; mount `createIntegrationRoutes({ verifyGmailRefreshToken, verifyDiscordChannel })` in `apps/api/src/app.ts`; add env passthrough for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE`, `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` to both `api` and `worker` services in `infrastructure/docker-compose.yml`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/integrations.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/tests/integrations.test.ts infrastructure/docker-compose.yml .env.example
git commit -m "feat(api): add integration management endpoints for Gmail and Discord"
```

---

### Task 13: End-to-end verification and runbook

**Files:**
- Create: `tests/e2e-event-pipeline.test.ts`
- Modify: `docs/phase/phase-1-event-pipeline.md` and `docs/PHASES.md` (tick the Phase 1 checkboxes — the same convention the Phase 0 commit `ffd8ce5` used)
- Test: `tests/e2e-event-pipeline.test.ts`

**Interfaces:**
- Consumes: `createGmailWebhookRoutes` (Task 8), `handleProcessGmailEvent` (Task 10), `handleNotifyDiscord` (Task 11), all query helpers.
- Produces: the phase's acceptance test, exercising the real database, real Redis streams, and fakes only at the network boundary (Gmail HTTP, Discord HTTP).

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// tests/e2e-event-pipeline.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import {
  db, events, agentTasks, clients, getOwnerUserId, upsertIntegration, deleteIntegration,
} from '@client-agent/db';
import { STREAMS, createRedisClient } from '@client-agent/queue';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { type DiscordNotifier } from '@client-agent/discord';
import { createGmailWebhookRoutes } from '../apps/api/src/routes/webhooks/gmail';
import { handleProcessGmailEvent } from '../apps/worker/src/handlers/processGmailEvent';
import { handleNotifyDiscord } from '../apps/worker/src/handlers/notifyDiscord';

const ownerId = await getOwnerUserId();
const suffix = Date.now();
const externalId = `e2e-${suffix}`;
const username = `E2EUser${suffix}`;
const historyId = '9000';
const notificationsStream = `${STREAMS.NOTIFICATIONS}_e2e_${suffix}`;
const redis = createRedisClient();
const createdTaskIds: number[] = [];

// Reads a Redis stream field list into a plain record so assertions do not depend on key order.
function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) record[fields[i]!] = fields[i + 1]!;
  return record;
}

const push = () => ({
  message: { data: Buffer.from(JSON.stringify({ emailAddress: 'me@example.com', historyId })).toString('base64') },
});

const gmail = {
  getProfile: async () => ({ emailAddress: 'me@example.com', historyId: '8000' }),
  listHistory: async () => ({ messageIds: [externalId], latestHistoryId: historyId }),
  fetchMessageById: async (id: string) => ({
    id, threadId: 'th-1', subject: `@${username} sent you a new message!`,
    from: 'VGen <no-reply@vgen.co>', date: '2026-10-16T14:32:11.000Z',
  }),
};

const app = new Elysia().use(createGmailWebhookRoutes({ resolveGmailClient: async () => gmail, audience: null }));
const deliver = () => app.handle(new Request('http://localhost/api/v1/webhooks/google/gmail', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(push()),
}));

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(agentTasks).where(eq(agentTasks.id, id));
  await db.delete(events).where(eq(events.externalId, externalId));
  await db.delete(clients).where(eq(clients.username, username));
  await redis.del(notificationsStream);
  await deleteIntegration(ownerId, 'gmail');
  redis.disconnect();
});

describe('Phase 1 event pipeline end to end', () => {
  it('turns one VGen notification into exactly one Discord message', async () => {
    await upsertIntegration({ userId: ownerId, provider: 'gmail', status: 'connected', metadata: { lastHistoryId: historyId } });

    // Pub/Sub delivers the same notification twice.
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200);

    const eventRows = await db.select().from(events).where(eq(events.externalId, externalId));
    expect(eventRows).toHaveLength(1);
    const event = eventRows[0]!;

    const processTasks = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, `gmail_event:${event.id}:process`));
    expect(processTasks).toHaveLength(1);
    createdTaskIds.push(processTasks[0]!.id);
    await handleProcessGmailEvent({ id: '1-0', data: { taskId: String(processTasks[0]!.id) } }, { notificationsStream });

    const entries = await redis.xrange(notificationsStream, '-', '+');
    expect(entries).toHaveLength(1);
    const notifyTaskId = Number(fieldsToRecord(entries[0]![1] as string[]).taskId);

    const messages: string[] = [];
    const notifier: DiscordNotifier = {
      sendEventNotification: async (_channelId, notification) => { messages.push(JSON.stringify(notification)); return { messageId: 'msg-1' }; },
      verifyChannel: async () => ({ id: 'chan-1', name: 'vgen-alerts' }),
    };
    await handleNotifyDiscord({ id: entries[0]![0], data: { taskId: String(notifyTaskId) } }, { notifier, channelId: 'chan-1' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(username);

    expect((await db.select().from(clients).where(eq(clients.username, username)))[0]!.platform).toBe('vgen');
    expect((await db.select().from(agentTasks).where(eq(agentTasks.id, notifyTaskId)))[0]!.status).toBe(TaskStatus.COMPLETED);
    createdTaskIds.push(notifyTaskId);
    expect((await db.select().from(events).where(eq(events.id, event.id)))[0]!.status as string).toBe('processed');
    expect((await db.select().from(agentTasks).where(eq(agentTasks.id, processTasks[0]!.id)))[0]!.type).toBe(TaskType.PROCESS_GMAIL_EVENT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/e2e-event-pipeline.test.ts`
Expected: FAIL — the file does not exist yet, so the runner reports a module/import failure before any assertion runs. Record the actual failure text.

- [ ] **Step 3: Make the scenario pass. Fix what the end-to-end run exposes (usually ordering, a missing `await`, or a task row left in `queued`) until the single scenario holds with both Postgres and Redis up**

- [ ] **Step 4: Run the whole suite and the type checker**

Run:
```bash
bun test
bun run typecheck
```
Expected: every workspace suite passes; `tsc --noEmit` reports no errors.

- [ ] **Step 5: Manual runbook (record the outcome in the PR description)**

```bash
# 1. Infrastructure
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
bun run --filter=@client-agent/db db:migrate
bun run --filter=@client-agent/db seed

# 2. Apps
bun run dev:api      # terminal 1
bun run dev:worker   # terminal 2

# 3. Connect integrations (session cookie from POST /api/v1/auth/login)
curl -i -X POST http://localhost:3001/api/v1/integrations/gmail \
  -H 'Content-Type: application/json' -H 'Cookie: session=<session>' \
  -d '{"refreshToken":"<google refresh token>"}'
curl -i -X POST http://localhost:3001/api/v1/integrations/discord \
  -H 'Content-Type: application/json' -H 'Cookie: session=<session>' \
  -d '{"channelId":"<discord channel id>"}'
curl -i http://localhost:3001/api/v1/integrations -H 'Cookie: session=<session>'

# 4. Simulate a Pub/Sub push (verification is skipped only when GOOGLE_PUBSUB_AUDIENCE is unset;
#    to simulate locally, either unset it in .env or send a valid OIDC Authorization: Bearer <token>)
DATA=$(printf '{"emailAddress":"me@example.com","historyId":"12345"}' | base64 -w0)
curl -i -X POST http://localhost:3001/api/v1/webhooks/google/gmail \
  -H 'Content-Type: application/json' -d "{\"message\":{\"data\":\"$DATA\"}}"
```

Google Cloud setup (once): create the Pub/Sub topic, grant `gmail-api-push@system.gserviceaccount.com` the Publisher role, create a push subscription to `${APP_URL}/api/v1/webhooks/google/gmail` with OIDC auth using `GOOGLE_PUBSUB_AUDIENCE` as the audience, and call `users.watch` with `GOOGLE_PUBSUB_TOPIC`; re-issue the watch every 7 days (ADR-007). Then confirm: the worker logs `PROCESS_GMAIL_EVENT` → `NOTIFY_DISCORD`, one Discord message appears, and a second delivery of the same notification produces no second message.

- [ ] **Step 6: Tick the Phase 1 checkboxes in `docs/phase/phase-1-event-pipeline.md` and `docs/PHASES.md` for every item the verification actually proved, then commit**

```bash
git add tests/e2e-event-pipeline.test.ts docs/phase/phase-1-event-pipeline.md docs/PHASES.md
git commit -m "test(e2e): verify the Phase 1 Gmail to Discord event pipeline"
```

---

## Phase Done Checklist (maps to the spec)

- [ ] `events`, `clients`, `agent_tasks`, `integrations` exist with migrations applied (Task 3).
- [ ] VGen parser handles every documented subject pattern plus unknown wording without throwing (Task 5).
- [ ] A duplicate Gmail message id produces one `events` row, one `PROCESS_GMAIL_EVENT` task, one `NOTIFY_DISCORD` task, one Discord message (Tasks 3, 8, 10, 13).
- [ ] The client row is created on first contact and `last_seen_at` advances on repeat contact (Tasks 4, 10).
- [ ] The worker delivers one Discord embed-free text notification per incoming message notification (Tasks 9, 11, 13).
- [ ] `GET /api/v1/integrations` reports Gmail and Discord connection status and never returns sealed credentials (Task 12).
- [ ] `bun test` and `bun run typecheck` pass across the monorepo (Task 13).
