# Phase 3 — VGen Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely retrieve and persist VGen conversation threads via Playwright with a dedicated authenticated profile, behind a clean `PlatformAdapter` interface, exposed through a Discord `/read` command and read/sync API endpoints.

**Architecture:** Queue-first: the Discord `/read` interaction (gateway bot running inside the worker process) and the Elysia API only create a `READ_VGEN_CONVERSATION` / `SYNC_CONVERSATION` task and publish to `client-agent:browser`; the worker performs all browser work through `packages/vgen` → `packages/platform` → `packages/browser`. Messages are deduplicated by `(conversation_id, external_id)` with a deterministic sha256 hash as fallback id. Session expiry surfaces as a non-retriable failure (DEAD) plus a Discord alert and an audit log.

**Tech Stack:** Bun workspaces, TypeScript, Playwright (persistent context + chromium), cheerio (pure DOM parsing), Drizzle ORM + PostgreSQL, Redis Streams, discord.js v14 (REST + gateway `Client`), Elysia + TypeBox, `bun:test`.

**Spec:** `docs/phase/phase-3-vgen-reader.md` (authoritative task list), plus `docs/DATA_MODEL.md` (tables), `docs/API.md` (conversation routes), `docs/ARCHITECTURE.md` (read-conversation flow), and repository `AGENTS.md` rules.

## Global Constraints (from AGENTS.md + spec, verbatim)

- NEVER store the VGen password in code, DB, or environment.
- NEVER attempt to bypass CAPTCHA, 2FA, cloudflare challenges, or anti-bot mechanisms. Therefore: **do not override the browser user agent** and add no stealth plugins — default Playwright fingerprint only.
- Authentication is done manually once in the dedicated browser profile (`BROWSER_PROFILE_PATH`, already in `packages/config/src/schema.ts` with default `./browser-profile`).
- Queue-first: browser navigation/scraping never runs inside Elysia handlers; only the worker drives the browser.
- Strict deduplication: `UNIQUE(platform, external_id)` on conversations; `UNIQUE(conversation_id, external_id)` on messages; `ON CONFLICT DO NOTHING` on re-sync.
- `audit_logs` is immutable (no `updated_at`, never updated/deleted).
- Tests use `bun test`; DB/Redis-facing tests hit real services (existing repo convention); external systems (Discord REST, VGen over HTTP) are replaced with injected stubs or Playwright route interception.
- API errors use `{ error: { code, message } }`; protected routes use `authPlugin` with `{ isAuth: true }`.
- Every new package mirrors the existing format: `"private": true, "type": "module", "main": "./src/index.ts"`, deps via `"workspace:*"`.

## Decisions Locked (executor must not re-litigate these)

1. **`packages/platform` is a real workspace package** (spec offered package *or* domain file; AGENTS.md pins the package location).
2. **Discord gateway bot runs inside the worker process** (`apps/worker`), not as a separate app. It enqueues tasks directly (`createTask` + `publishTask` to `STREAMS.BROWSER`) because the bot cannot authenticate to the Elysia API (cookie-session auth, no machine credentials). `docs/ARCHITECTURE.md`'s "bot sends request to Elysia API" describes the phase-4 `/agent/run` shape; the phase-3 spec explicitly allows "Send API request to Elysia **or** enqueue READ_VGEN_CONVERSATION task".
3. **No new TaskType values.** Reuse `READ_VGEN_CONVERSATION` and `SYNC_CONVERSATION`. The Discord preview is sent by the read handler itself (spec Task 3.5 wording); no separate notify task type is introduced.
4. **"Pause task" = `DEAD`** (no PAUSED status exists). Session expiry → Discord alert + audit `SESSION_EXPIRED` + task dead-lettered via a new `NonRetriableError` thrown through `runTask`. Recovery: creator re-authenticates, then runs `/read` again or uses the existing `POST /api/v1/agent/tasks/:id/retry`.
5. **All VGen browser tasks flow through `STREAMS.BROWSER` only.** `getStreamForTaskType` is edited so `SYNC_CONVERSATION` maps to `STREAMS.BROWSER` too — two Playwright contexts sharing one profile directory would corrupt it; browser work is strictly serialized behind the single BROWSER consumer + shared browser context.
6. **`MessageResult.sentAt: Date | null`** (spec says `Date`, but VGen DOM timestamps may be relative text; nullable matches `Message.sentAt` in `packages/domain/src/entities.ts`).
7. **`messages.external_id` is NOT NULL** (spec said nullable): the deterministic `sha256(threadId|sender|content|rawTime)` fallback makes dedup airtight. Raw DOM timestamp text survives as `MessageResult.sentAtRaw` and is stored in `messages.metadata.sentAtRaw` for later re-parsing.
8. **`ConversationResult` gains `clientUsername`** (spec's shape is the minimum; the worker needs it to upsert the client row).
9. **`audit_logs` table + `insertAuditLog` are built in this phase** (DATA_MODEL defines the table; `AuditAction.AGENT_READ_CONVERSATION` / `SESSION_EXPIRED` already exist in domain enums; AGENTS.md requires audits for critical state changes).
10. **DOM parsing is pure and cheerio-based:** browser code waits for content, then captures `outerHTML` of message blocks and hands them to `parse.ts` — fully unit-testable via fixture HTML; locator logic and DOM-text parsing never mix.
11. **Preview/session-alert delivery is best-effort:** PostgreSQL persistence happens first; a Discord send failure is recorded in task output (`deliveryError`) but does not fail the task.
12. **The `/read` interaction replies immediately** with the literal text `"Fetching conversation for @<username>... ⏳"` via `interaction.reply(...)` (deferred-style flow, spec Task 3.6), and the final preview is delivered by the worker **editing that original message** (`PATCH /webhooks/{applicationId}/{interactionToken}/messages/@original`), falling back to a fresh channel message when no token exists or the edit 404s. The interaction token lives ≤15 min; the fallback covers failures.
13. **Manual reads are not deduplicated across invocations:** idempotency keys embed the unique `interactionId` (or a UUID for API calls). AGENTS.md's strict-dedup rule targets event/webhook duplication, not intentional user-triggered reads.

## Review Focus (inputs the spec implies but a test must pin)

1. **Repeated `/read <same user>`** never duplicates messages: second run inserts 0 new rows, returns the same conversation id, updates `last_synced_at`. → Task 2 tests (`insertMessagesIfNew` twice) + Task 9 rerun test.
2. **A second browser consumer sharing the profile directory** would corrupt the Playwright profile — none may exist. → Task 10 pins `getStreamForTaskType(SYNC_CONVERSATION) === STREAMS.BROWSER` and a `SYNC_CONVERSATION` payload published on `STREAMS.BROWSER` is claimed by the BROWSER consumer.
3. **Session expired → retry storm:** one attempt, then DEAD/backoff-free, alert exactly once. → Task 6 test (`NonRetriableError` through `runTask`) + Task 9 test.
4. **Discord 2000-char cap on previews/alerts:** long content truncates, never crashes the task. → Task 8 test.
5. **Playwright under the Bun runtime** is the riskiest environment assumption. → Task 4 opens with a launch-and-read spike under `bun test` so an incompatibility surfaces in the first hour.
6. *(statement, no test)* The adapter only reads rendered DOM: it never logs/persists cookies, never evaluates page JS, never follows embedded scripts. Fixtures stay synthetic — real client content is NEVER committed.

## File Structure

| File | Responsibility |
|---|---|
| `packages/platform/src/index.ts` | Pure contracts: `PlatformAdapter`, input/result types (zero deps) |
| `packages/browser/src/context.ts` | Persistent-context launch, shared singleton, close |
| `packages/browser/src/session.ts` | `checkVGenAuthStatus(page)` — auth detection only |
| `packages/shared/src/crypto.ts` (modify) | `sha256Hex(input)` — deterministic message ids |
| `packages/vgen/src/errors.ts` | `SessionExpiredError`, `ClientNotFoundError`, `NavigationTimeoutError`, `NotSupportedError` |
| `packages/vgen/src/selectors.ts` | All VGen URLs/selectors as named constants (the calibration point) |
| `packages/vgen/src/parse.ts` | Pure `extractMessages` / `toMessageResult` / `parseExternalThreadId` / `parseVGenTimestamp` |
| `packages/vgen/src/read.ts` | Page flow: `openThread`, `scrapeThreadMessages` |
| `packages/vgen/src/adapter.ts` | `VGenBrowserAdapter implements PlatformAdapter` |
| `packages/vgen/scripts/smoke-vgen-read.ts` | Manual calibration/verification against the real session |
| `packages/db/src/schema/{conversations,messages,audits}.ts` | Three tables per DATA_MODEL |
| `packages/db/src/queries/{conversations,messages,audits}.ts` | Upsert/find/touch + `insertMessagesIfNew` + `insertAuditLog` |
| `packages/queue/src/errors.ts` + `runner.ts` (modify) | `NonRetriableError` + DEAD-without-retry path |
| `packages/discord/src/client.ts` (modify) | `DiscordMessenger` methods on the same notifier object |
| `packages/discord/src/commands/read.ts` | `READ_COMMAND`, `formatConversationPreview`, `handleReadInteraction` |
| `packages/discord/src/bot.ts` | Gateway client, command registration, interaction router |
| `apps/worker/src/handlers/readVgenConversation.ts` | `handleReadVgenConversation`, `handleSyncConversation`, shared `runConversationRead` |
| `apps/worker/src/services/vgen.ts` | Deps resolution (adapter + messenger) |
| `apps/worker/src/services/discord.ts` (modify) | `DiscordNotifierDeps` gains `messenger` |
| `apps/worker/src/bot.ts` | `/read` enqueuer + `startWorkerDiscordBot` |
| `apps/worker/src/index.ts` (modify) | BROWSER consumer, bot start/stop, browser close on shutdown |
| `apps/api/src/routes/conversations.ts` | `POST /sync` (username) and `POST /:id/sync` |
| `apps/api/src/routes/tasks.ts` (modify) | `getStreamForTaskType`: `SYNC_CONVERSATION` → `STREAMS.BROWSER` |
| `scripts/setup-browser-session.ts` | One-time manual login helper (non-headless) |
| `tsconfig.json` (modify) | Add 3 path aliases |
| `.gitignore` (modify) | Ignore `browser-profile/` |

---

### Task 1: DB Schema — conversations, messages, audit_logs

**Files:**
- Create: `packages/db/src/schema/conversations.ts`
- Create: `packages/db/src/schema/messages.ts`
- Create: `packages/db/src/schema/audits.ts`
- Modify: `packages/db/src/schema/index.ts` (append 3 export lines)
- Test: `packages/db/tests/conversations.test.ts` (new)

**Interfaces:**
- Consumes: `clients` (`packages/db/src/schema/clients.ts`) and `users` tables.
- Produces: exported tables `conversations`, `messages`, `auditLogs` + row types `ConversationRow`, `MessageRow`, `AuditLogRow` via `$inferSelect`/`$inferInsert` (same pattern as `clients.ts`).

- [ ] **Step 1: Write the failing schema test**

Follow the cleanup style of `packages/db/tests/queries.test.ts` (real PG, delete seeded rows in `afterAll`). Assertions:

```ts
// seed one user (getOwnerUserId) + one client row, then:
// 1. insert conversation (clientId, platform 'vgen', externalId 'thread-1', externalUrl 'https://vgen.co/inbox/thread-1')
//    → returns row; status defaults 'active'; lastSyncedAt null
// 2. second insert with same (platform, externalId) → REJECTS (unique conversations_platform_external_id catches 23505)
// 3. insert message (conversationId, externalId 'm1', direction 'inbound', senderType 'client',
//    senderName 'ErianOsamu', content 'Hello!', sentAt new Date()) → row created;
//    second insert same (conversationId, externalId) → REJECTS
// 4. insert auditLog (userId, actorType 'agent', action 'AGENT_READ_CONVERSATION', targetType 'conversation', targetId 1)
//    → row readable; returned object has NO updatedAt key (immutable table)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/conversations.test.ts`
Expected: FAIL — `conversations`/`messages`/`auditLogs` imports are undefined.

- [ ] **Step 3: Write the three schema files** (mirror `clients.ts` exactly: `bigserial(..., { mode: 'number' }).primaryKey()`, `varchar` with explicit lengths, `timestamp(..., { withTimezone: true }).defaultNow().notNull()`, third arg `(t) => [unique('<snake_name>').on(...)]`, `$inferSelect`/`$inferInsert` exports)

- `conversations`: `id`, `clientId` (bigint mode number, notNull, FK→`clients.id`), `platform` (varchar 50, notNull, default `'vgen'`), `externalId` (varchar 255, **notNull**), `externalUrl` (varchar 500, nullable), `status` (varchar 20, notNull, default `'active'`), `lastSyncedAt` (timestamptz, nullable), `createdAt`, `updatedAt`. Constraint: `unique('conversations_platform_external_id').on(t.platform, t.externalId)`.
- `messages`: `id`, `conversationId` (bigint, notNull, FK→`conversations.id`), `externalId` (varchar 255, **notNull** — decision #7), `direction` (varchar 20, notNull), `senderType` (varchar 20, notNull), `senderName` (varchar 255, notNull), `content` (`text`, notNull), `metadata` (jsonb, notNull, default `{}`), `sentAt` (timestamptz, nullable), `createdAt`, `updatedAt`. Constraint: `unique('messages_conversation_external_id').on(t.conversationId, t.externalId)`.
- `audits`: table name `audit_logs`: `id`, `userId` (bigint, nullable, FK→`users.id`), `actorType` (varchar 20, notNull), `actorId` (bigint, nullable), `action` (varchar 50, notNull), `targetType` (varchar 50, notNull), `targetId` (bigint, notNull), `metadata` (jsonb, notNull, default `{}`), `ipAddress` (varchar 45, nullable), `createdAt` only — **no updatedAt** (immutable per DATA_MODEL).

Append to `packages/db/src/schema/index.ts`:
```ts
export * from './conversations';
export * from './messages';
export * from './audits';
```

- [ ] **Step 4: Generate and run the migration**

Run: `bun run --filter=@client-agent/db db:generate`
Expected: new migration file under `packages/db/drizzle/` (`0003_<auto-name>.sql`), journal updated.
Run: `bun run --filter=@client-agent/db db:migrate`
Expected: applies clean (Postgres must be up: `docker compose -f infrastructure/docker-compose.yml up -d postgres redis`).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/db/tests/conversations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema packages/db/tests/conversations.test.ts packages/db/drizzle
git commit -m "feat(db): add conversations, messages, audit_logs schemas"
```

---

### Task 2: DB Queries — upserts, dedup inserts, audit writer

**Files:**
- Create: `packages/db/src/queries/conversations.ts`
- Create: `packages/db/src/queries/messages.ts`
- Create: `packages/db/src/queries/audits.ts`
- Modify: `packages/db/src/queries/index.ts` (append 3 export lines)
- Test: `packages/db/tests/queries-phase3.test.ts` (new)

**Interfaces:**
- Consumes: tables from Task 1; `upsertClient`, `getOwnerUserId` (existing, used by tests for seeding).
- Produces (exact signatures — Tasks 9, 10, 11 type against these):

```ts
// queries/conversations.ts
export interface UpsertConversationInput {
  clientId: number; platform: string; externalId: string; externalUrl?: string | null;
}
export async function upsertConversation(input: UpsertConversationInput): Promise<ConversationRow>
// .onConflictDoUpdate({ target: [conversations.platform, conversations.externalId],
//   set: { externalUrl: input.externalUrl ?? null, status: 'active', updatedAt: sql`now()` } }).returning() → rows[0]!
export async function findConversationByExternalId(platform: string, externalId: string): Promise<ConversationRow | null>
export async function getConversationById(id: number): Promise<ConversationRow | null>
export async function touchConversationLastSynced(id: number): Promise<void>
// update set { lastSyncedAt: sql`now()`, updatedAt: sql`now()` }
export interface ConversationWithClient { conversation: ConversationRow; clientId: number; clientUsername: string }
export async function getConversationWithClient(id: number): Promise<ConversationWithClient | null>
// innerJoin clients; null when the row is missing

// queries/messages.ts
export interface NewMessageInput {
  externalId: string; direction: 'inbound' | 'outbound';
  senderType: 'client' | 'creator' | 'agent'; senderName: string;
  content: string; sentAt?: Date | null; metadata?: Record<string, unknown>;
}
export async function insertMessagesIfNew(conversationId: number, messages: NewMessageInput[]): Promise<number>
// single insert with chunked VALUES (100 rows max per statement to stay under parameter limits),
// .onConflictDoNothing({ target: [messages.conversationId, messages.externalId] }).returning(); return rows.length

// queries/audits.ts
export interface InsertAuditLogInput {
  userId?: number | null; actorType: 'user' | 'agent' | 'system'; actorId?: number | null;
  action: string; targetType: string; targetId: number; metadata?: Record<string, unknown>;
}
export async function insertAuditLog(input: InsertAuditLogInput): Promise<AuditLogRow>
```

- [ ] **Step 1: Write the failing test** — assertions:
  1. `upsertConversation` called twice with identical `(platform, externalId)` returns rows sharing the **same id**; the second call's row carries the updated `externalUrl`.
  2. `insertMessagesIfNew(strconvId, msgs)` with 3 messages returns `3`; calling again with the same 3 + 1 new message returns `1`; total rows stays 4. `sentAt: null` accepted.
  3. `insertMessagesIfNew` with 150 uniquely-keyed messages returns `150` (chunking works) and `0` on repeat.
  4. `touchConversationLastSynced` makes `lastSyncedAt` non-null.
  5. `getConversationWithClient` returns the client username for a seeded conversation; `null` for a missing id.
  6. `insertAuditLog({ actorType: 'agent', action: 'SESSION_EXPIRED', ..., targetId: taskId })` row is readable back.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/queries-phase3.test.ts`
Expected: FAIL — module functions undefined.

- [ ] **Step 3: Implement the three query files** (each body is one `db.insert/select/update` chain following `queries/tasks.ts` style incl. `rows[0]!`) plus the exports in `queries/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/tests/queries-phase3.test.ts && bun test packages/db`
Expected: PASS (pre-existing db tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries packages/db/tests/queries-phase3.test.ts
git commit -m "feat(db): conversation/message/audit queries with dedup upserts"
```

---

### Task 3: `packages/platform` — adapter contracts

**Files:**
- Create: `packages/platform/package.json`, `packages/platform/src/index.ts`
- Modify: `tsconfig.json` — add aliases `@client-agent/platform`, `@client-agent/browser`, `@client-agent/vgen` (each `"@x/<name>" → ["./packages/<name>/src/index.ts"]` + `"@x/<name>/*" → ["./packages/<name>/src/*"]`, extending lines 16–31)
- Test: `packages/platform/tests/platform.test.ts`

**Interfaces:**
- Produces (exact — Tasks 5, 6, 8, 9 type against this):

```ts
export interface FindClientInput { username: string }
export interface ClientResult { id: string; username: string; displayName?: string }
export interface GetConversationInput { clientUsername: string; limit?: number }
export interface MessageResult {
  externalId: string;
  direction: 'inbound' | 'outbound';
  senderName: string;
  content: string;
  sentAt: Date | null; // null when the DOM only exposes relative time (decision #6)
  sentAtRaw?: string | null; // raw DOM timestamp text; feeds messages.metadata.sentAtRaw (decision #7)
}
export interface ConversationResult {
  externalId: string;
  externalUrl: string;
  clientUsername: string; // decision #8
  messages: MessageResult[];
}
export interface PlatformAdapter {
  findClient(input: FindClientInput): Promise<ClientResult>;
  getConversation(input: GetConversationInput): Promise<ConversationResult>;
  getMessages(input: { conversationId: string; limit?: number }): Promise<MessageResult[]>;
  sendMessage(input: { conversationId: string; content: string }): Promise<{ success: boolean; messageId: string }>;
}
```

- [ ] **Step 1: Write the failing test** — a compile/link check of package wiring. `import type { ConversationResult, PlatformAdapter } from '@client-agent/platform'`; define a const typed `PlatformAdapter` whose `getConversation` resolves `{ externalId: 't1', externalUrl: 'u', clientUsername: 'me', messages: [with sentAt: null] }` and whose other three methods throw; assert `(await adapter.getConversation({ clientUsername: 'me' })).externalId === 't1'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/platform/tests/platform.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the package** (`package.json`: name `@client-agent/platform`, version `0.1.0`, zero runtime deps) and `src/index.ts` exporting exactly the contracts above — types + interfaces only, no implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform/tests/platform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform tsconfig.json
git commit -m "feat(platform): add PlatformAdapter interface contracts"
```

---

### Task 4: `packages/browser` — Playwright context + session checker

**Files:**
- Create: `packages/browser/package.json`, `packages/browser/src/index.ts`, `packages/browser/src/context.ts`, `packages/browser/src/session.ts`
- Modify: `.gitignore` (add `browser-profile/`)
- Test: `packages/browser/tests/browser.test.ts`

**Interfaces:**
- Consumes: `config.BROWSER_PROFILE_PATH` from `@client-agent/config`.
- Produces (exact — Task 6 consumes):

```ts
// context.ts
export interface LaunchPersistentContextOptions { profilePath?: string; headless?: boolean }
export async function launchPersistentContext(options?: LaunchPersistentContextOptions): Promise<BrowserContext>
// chromium.launchPersistentContext(resolvedPath, { headless: options?.headless ?? true, viewport: { width: 1280, height: 720 } })
// Relative profile paths resolve against process.cwd() (standard Node semantics) — tests pass absolute tmp dirs.
// NEVER override userAgent and NEVER add stealth flags (global constraints).
export async function getSharedBrowserContext(): Promise<BrowserContext> // lazy singleton (headless, config profile path)
export async function closeSharedBrowserContext(): Promise<void> // close + clear singleton; safe when never started

// session.ts
export async function checkVGenAuthStatus(page: Page, options?: { dashboardUrl?: string }): Promise<boolean>
// 1. goto (options?.dashboardUrl ?? VGEN_DASHBOARD_URL from @client-agent/vgen selectors? NO — browser is selector-free:
//    define its own constant VGEN_DASHBOARD_URL = 'https://vgen.co/dashboard' inside packages/browser/src/session.ts
//    so browser stays decoupled from vgen; Task 5's selectors file records the same value for the record flow)
// 2. waitUntil: 'domcontentloaded'; if the final URL contains '/login' → false
// 3. return page.locator(AUTH_MARKER_SELECTOR).isVisible() (no waiting, immediate boolean)
```

- [ ] **Step 1: Create package + install Playwright**

```bash
cd packages/browser && bun add playwright && cd ../..
bunx playwright install chromium
```
Expected: `playwright` in `packages/browser/package.json` deps; chromium binary downloaded.

- [ ] **Step 2: Write the failing spike test (Bun + Playwright compat gate, Review Focus #5)**

```ts
// First test: launchPersistentContext into a fresh os.tmpdir() mkdtemp dir, page.setContent('<p id="x">ok</p>'),
// expect (await page.evaluate(() => document.querySelector('#x')?.textContent)) === 'ok'
```

- [ ] **Step 3: Write the failing auth-status test (route interception, zero network)**

```ts
// page.route('**/vgen.co/**', ...) fulfills:
//   /dashboard → HTML containing the auth marker   → checkVGenAuthStatus(page) === true
//   /dashboard → response with redirection to /login → false
//   /dashboard → plain HTML without marker          → false
```

Run: `bun test packages/browser/tests/browser.test.ts`
Expected: FAIL (functions undefined) → implement → PASS.

- [ ] **Step 4: Implement `context.ts` + `session.ts`**, export both from `src/index.ts`. If the spike fails irrecoverably under bun, STOP and report — tasks 6–9 depend on this runtime.- [ ] **Step 5: Re-run to verify everything passes**

Run: `bun test packages/browser/tests/browser.test.ts`
Expected: PASS (spike + 3 auth cases).

- [ ] **Step 6: Commit**

```bash
git add packages/browser .gitignore
git commit -m "feat(browser): playwright persistent context and VGen auth check"
```

---

### Task 5: `packages/shared` hash + `packages/vgen` errors, selectors, pure parser

**Files:**
- Modify: `packages/shared/src/crypto.ts` (add `sha256Hex`); extend `packages/shared/tests/crypto.test.ts`
- Create: `packages/vgen/package.json`, `packages/vgen/src/index.ts`, `packages/vgen/src/errors.ts`, `packages/vgen/src/selectors.ts`, `packages/vgen/src/parse.ts`
- Create: `packages/vgen/tests/fixtures/thread.html` (committed fixture)
- Test: `packages/vgen/tests/parse.test.ts` (new)

**Interfaces:**
- Consumes: `MessageResult` from `@client-agent/platform` (Task 3).
- Produces (exact — Task 6 consumes):

```ts
// shared/src/crypto.ts
export function sha256Hex(input: string): string
// new Bun.CryptoHasher('sha256').update(input).digest('hex')

// vgen/src/errors.ts
export class SessionExpiredError extends Error {}     // message: 'VGen session has expired — manual re-login required'
export class ClientNotFoundError extends Error {}     // message includes the requested username
export class NavigationTimeoutError extends Error {}  // wraps Playwright timeout details
export class NotSupportedError extends Error {}       // message: 'not implemented until a later phase: <method>'

// vgen/src/selectors.ts — ALL VGen knowledge lives here; calibration adjusts ONLY this file
export const VGEN_BASE_URL = 'https://vgen.co';
export const VGEN_DASHBOARD_URL = 'https://vgen.co/dashboard';   // matches browser/src/session.ts constant
export const VGEN_INBOX_URL = 'https://vgen.co/inbox';
export const VGEN_LOGIN_PATH_HINT = '/login';
export const AUTH_MARKER_SELECTOR = '[data-testid="user-avatar"], img[alt="Account"]';
export const INBOX_THREAD_ITEM_SELECTOR = '[data-testid="conversation-item"]';
export const THREAD_URL_PATTERN = /vgen\.co\/(?:inbox|messages)\/(?<threadId>[A-Za-z0-9_-]+)/i;
export const THREAD_MESSAGE_SELECTOR = '[data-testid="thread-message"]';
export const MESSAGE_SENDER_SELECTOR = '[data-testid="message-sender"]';
export const MESSAGE_BODY_SELECTOR = '[data-testid="message-body"]';
export const MESSAGE_TIME_SELECTOR = 'time';
export const OUTBOUND_MARKER = 'data-outbound'; // attribute on outbound message blocks
// Values are provisional guesses; Task 6 calibrates them against the real DOM.

// vgen/src/parse.ts — pure functions, no page objects
export interface ParsedThreadMessage { senderName: string; content: string; sentAtRaw: string | null; isOutbound: boolean }
export function extractMessages(blockHtml: string | string[]): ParsedThreadMessage[]
// cheerio 'html parser'.load(...)('\`${THREAD_MESSAGE_SELECTOR}') — accepts full thread HTML or per-block outerHTML;
// trims sender/body/time; SKIPS blocks with empty body
export function toMessageResult(m: ParsedThreadMessage, threadId: string): MessageResult
// externalId = sha256Hex(\`\${threadId}|\${senderName}|\${content}|\${sentAtRaw ?? ''}\`)
// sentAt = parseVGenTimestamp(sentAtRaw); sentAtRaw passthrough; direction = isOutbound ? 'outbound' : 'inbound'
export function parseExternalThreadId(url: string): string | null   // THREAD_URL_PATTERN.exec(url)?.groups?.threadId ?? null
export function parseVGenTimestamp(raw: string | null): Date | null // absolute ISO/Date-parseable → Date; else null
```

- [ ] **Step 1: Write the failing tests**
  - Extend `packages/shared/tests/crypto.test.ts`: `sha256Hex('abc')` equals the known sha256 hex `ba7816bfa8d1f6...` prefix; stable across calls.
  - `packages/vgen/tests/parse.test.ts` (fixtures):
    - `extractMessages` over `thread.html` returns 3 messages in DOM order with correct sender/content/`isOutbound`.
    - `toMessageResult` returns the SAME `externalId` for equal input twice and a DIFFERENT id when content changes by one character.
    - `parseVGenTimestamp('2026-10-17T08:30:00Z')` → `Date`; `parseVGenTimestamp('2h ago')` → `null`; `parseVGenTimestamp(null)` → `null`.
    - `parseExternalThreadId('https://vgen.co/inbox/abc123')` → `'abc123'`; `'https://vgen.co/inbox'` → `null`.
    - A message block with an empty body is skipped.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/shared/tests/crypto.test.ts packages/vgen/tests/parse.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — first `cd packages/vgen && bun add cheerio @client-agent/platform @client-agent/browser` (parse + flow need them), then write the fixture file:

```html
<!-- packages/vgen/tests/fixtures/thread.html (synthetic, PII-free by construction) -->
<div class="thread" data-thread-id="abc123">
  <div class="msg" data-testid="thread-message" data-outbound="true">
    <span data-testid="message-sender">Rida</span>
    <p data-testid="message-body">Hi, I can start next week.</p>
    <time>2026-10-17T08:30:00Z</time>
  </div>
  <div class="msg" data-testid="thread-message">
    <span data-testid="message-sender">ErianOsamu</span>
    <p data-testid="message-body">Please use the payment plan B.</p>
    <time>2h ago</time>
  </div>
  <div class="msg" data-testid="thread-message" data-outbound="true">
    <span data-testid="message-sender">Rida</span>
    <p data-testid="message-body">Sure, updating the invoice now.</p>
  </div>
</div>
<!-- a fourth block with an empty <p data-testid="message-body"></p> must be appended and skipped by tests -->
```

then the four `packages/vgen/src/*` files + `sha256Hex`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/shared/tests/crypto.test.ts packages/vgen/tests/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vgen packages/shared
git commit -m "feat(vgen): pure DOM parser, selectors, error types; sha256 helper"
```

---

### Task 6: `packages/vgen` — VGen flow + adapter + smoke calibration

**Files:**
- Create: `packages/vgen/src/read.ts`, `packages/vgen/src/adapter.ts` (extend `src/index.ts` exports)
- Create: `packages/vgen/scripts/smoke-vgen-read.ts`
- Create: `packages/vgen/tests/fixtures/inbox.html`, `packages/vgen/tests/fixtures/login.html`
- Test: `packages/vgen/tests/adapter.test.ts` (new)

**Interfaces:**
- Consumes: `launchPersistentContext` / `getSharedBrowserContext` / `checkVGenAuthStatus` (`@client-agent/browser`, Tasks 4–5); own `parse.ts` + `selectors.ts` (Task 5); `PlatformAdapter` types (Task 3).
- Produces (exact — Task 9 consumes):

```ts
// read.ts (page flow; zero parsing here)
export async function openThread(page: Page, username: string): Promise<{ threadId: string; url: string }>
// 1. goto(VGEN_INBOX_URL, { waitUntil: 'domcontentloaded' })
// 2. if page.url() contains VGEN_LOGIN_PATH_HINT → throw SessionExpiredError
// 3. item = page.locator(INBOX_THREAD_ITEM_SELECTOR).filter({ hasText: username }).first()
//    (await item.count()) === 0 → throw ClientNotFoundError(username)
// 4. await item.click(); await page.waitForURL(THREAD_URL_PATTERN, { timeout: 30_000 }) —
//    playwright timeout → throw NavigationTimeoutError('Waiting for conversation thread URL')
// 5. threadId = parseExternalThreadId(page.url()); null → throw NavigationTimeoutError('Thread URL missing id')
// 6. return { threadId, url: page.url() }

export async function scrapeThreadMessages(page: Page, limit: number): Promise<string[]>
// wait for THREAD_MESSAGE_SELECTOR first match ({ timeout: 15_000 }) → playwright timeout → NavigationTimeoutError;
// collect innerHTML of the LAST `limit` blocks (DOM order is oldest→newest); return [] when none present

// adapter.ts
export interface VGenAdapterOptions {
  createPage?: () => Promise<Page>;          // default: (await getSharedBrowserContext()).newPage()
  closePage?: (page: Page) => Promise<void>; // default: page.close()
}
export class VGenBrowserAdapter implements PlatformAdapter {
  constructor(options?: VGenAdapterOptions)
  async getConversation({ clientUsername, limit = 20 }): Promise<ConversationResult>
  async findClient(...) { throw new NotSupportedError('findClient') }
  async getMessages(...) { throw new NotSupportedError('getMessages') }
  async sendMessage(...): Promise<{ success: boolean; messageId: string }> { throw new NotSupportedError('sendMessage') }
}
// getConversation flow:
// const page = await createPage();
// try {
//   if (!(await checkVGenAuthStatus(page))) throw new SessionExpiredError();
//   const { threadId, url } = await openThread(page, clientUsername);
//   const blocks = await scrapeThreadMessages(page, limit);
//   const messages = blocks
//     .map((b) => toMessageResult(extractMessages(b)[0]!, threadId))
//     .filter((m) => m.content.length > 0);
//   return { externalId: threadId, externalUrl: url, clientUsername, messages };
// } catch (e) {
//   if (e instanceof playwright TimeoutError) throw new NavigationTimeoutError(String(e));
//   throw e;
// } finally { await closePage(page); }
```

- [ ] **Step 1: Write the failing adapter test (route-intercepted fake VGen)**

```ts
// Own chromium persistent context in a fresh tmp profile + page.route BEFORE navigation:
//   **/vgen.co/dashboard    → sticky-marker HTML (auth OK)
//   **/vgen.co/inbox        → inbox.html: contains 'Conversation with ErianOsamu' linking '/inbox/abc123'
//   **/vgen.co/inbox/abc123 → thread.html (Task 5 fixture content)
//   **/login                → login.html
// Case 1 (success): adapter.getConversation({ clientUsername: 'ErianOsamu', limit: 20 }) →
//   externalId 'abc123'; externalUrl contains '/inbox/abc123'; clientUsername 'ErianOsamu';
//   messages.length 3; sentAt[0] instanceof Date; sentAt[1] === null; stable externalIds.
// Case 2 (expired): new adapter on a fresh page where /dashboard responds with the login redirect
//   → expect rejects SessionExpiredError.
// Case 3 (unknown user): inbox without 'NoSuchUser' → expect rejects ClientNotFoundError.
// Case 4 (DI): pass createPage/closePage spies → closePage called after Case 1 AND after Case 2/3 (finally).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/vgen/tests/adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `read.ts`, `adapter.ts`, index re-exports → tests pass.

- [ ] **Step 4: Run the full package suite + typecheck**

Run: `bun test packages/vgen && bun run typecheck`
Expected: PASS; new aliases resolve (Task 3).

- [ ] **Step 5: CALIBRATE against the real DOM (manual; requires the authenticated profile from Task 12 Step 1 or a pre-existing login)**

Create `packages/vgen/scripts/smoke-vgen-read.ts`: arg `process.argv[2]` = username; creates its OWN persistent context (headless) on `config.BROWSER_PROFILE_PATH` (never the shared singleton); runs the same openThread+scrape+parse flow; prints the resulting `ConversationResult` JSON to stdout; `--dump` also prints up to 5 raw message-block `outerHTML` strings for selector inspection.

```bash
bun run packages/vgen/scripts/smoke-vgen-read.ts ErianOsamu
```
Expected: JSON with ≥1 message. **If selectors miss on a genuinely logged-in session:** update ONLY `packages/vgen/src/selectors.ts` (+ fixture HTML to mirror the observed structure), re-run Step 1–3 tests, then the smoke again. Never edit parse/flow logic to compensate selectors; never commit captured real content — fixtures stay synthetic at all times (Review Focus #6).

- [ ] **Step 6: Commit**

```bash
git add packages/vgen
git commit -m "feat(vgen): VGenBrowserAdapter read flow with fake-VGen tests and smoke script"
```

---

### Task 7: `packages/queue` — `NonRetriableError` support in the runner

**Files:**
- Create: `packages/queue/src/errors.ts`
- Modify: `packages/queue/src/runner.ts` (catch path honors non-retriable)
- Modify: `packages/queue/src/index.ts` (export `./errors`)
- Test: extend `packages/queue/tests/runner.test.ts`

**Interfaces:**
- Produces: `export class NonRetriableError extends Error {}` (queue-local; Task 9 wraps `SessionExpiredError` / `ClientNotFoundError` into it). `TaskExecutionResult.reason` gains `'non_retriable'` for this path.

- [ ] **Step 1: Write the failing test** (existing "Task Runner State Machine" style: real `createTask`, unique stream name, inline handler):

```ts
// handler: async () => { throw new NonRetriableError('boom-pause'); }
// expect result.status === 'dead'; expect result.reason === 'non_retriable';
// expect DB row status 'dead', attempts === 1, error contains 'boom-pause';
// expect XPENDING === 0 (acked); expect NO retry scheduled (pollDueRetries finds nothing to run).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/queue/tests/runner.test.ts`
Expected: FAIL — the current runner schedules a retry instead (status `'retried'`).

- [ ] **Step 3: Implement** — in `runner.ts` catch, FIRST branch: `if (error instanceof NonRetriableError) { await markTaskDead(taskId, error.message); await redis.xack(stream, group, task.id); return { status: 'dead', reason: 'non_retriable' }; }` before existing retry/dead logic; log via the same dead-letter console path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/queue`
Expected: PASS (existing retry/backoff/dead-letter cases unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/queue
git commit -m "feat(queue): NonRetriableError dead-letters immediately without backoff"
```

---

### Task 8: `packages/discord` — messenger methods, `/read` command, gateway bot

**Files:**
- Modify: `packages/discord/src/client.ts` (add `DiscordMessenger` + implementation inside the existing `createDiscordNotifier` factory return)
- Create: `packages/discord/src/commands/read.ts`, `packages/discord/src/bot.ts`
- Modify: `packages/discord/src/index.ts` (add `export * from './commands/read';` and `export * from './bot';`)
- Modify: `packages/discord/package.json` (add dep `@client-agent/platform`)
- Test: `packages/discord/tests/read.test.ts`, `packages/discord/tests/bot.test.ts` (new); extend `packages/discord/tests/client.test.ts`

**Interfaces:**
- Consumes: discord.js (`discord.js ^14.27.0` already a dep); `MessageResult` type from `@client-agent/platform`. No db/queue imports — all wiring is injected from the app layer.
- Produces (exact — Tasks 9, 10 consume):

```ts
// client.ts
export interface DiscordMessenger {
  // PATCH /webhooks/{applicationId}/{interactionToken}/messages/@original with { body: { content } };
  // 404 (expired/unknown token) → resolve { messageId: null } so the worker can fall back
  editInteractionFollowup(input: { applicationId: string; interactionToken: string; content: string }): Promise<{ messageId: string | null }>;
  sendChannelMessage(channelId: string, content: string): Promise<{ messageId: string }>; // POST /channels/{id}/messages
}
export function createDiscordNotifier(options: { token: string; rest?: DiscordRestLike }): DiscordNotifier & DiscordMessenger
// The combined return keeps every existing consumer type-valid: dependencies can treat the same object as either interface.

// commands/read.ts
import { ApplicationCommandOptionType } from 'discord.js';
export const READ_COMMAND = {
  name: 'read',
  description: 'Fetch the latest messages from a VGen conversation into this channel',
  options: [{ name: 'username', description: 'VGen username of the client', type: ApplicationCommandOptionType.String, required: true }],
}; // serializable command JSON handed to registerSlashCommands
export function formatConversationPreview(clientUsername: string, messages: MessageResult[]): string
// header '📨 Conversation with @<clientUsername> (latest N)' then per message:
// '**<sender> · <formatted UTC time | time unknown>**\n> <content with newlines collapsed, >200-char messages truncated>'
// HARD rule: if length exceeds 1900, drop OLDEST entries until it fits; the header is always kept (≤2000 total).
export interface PendingConversationMessage { clientUsername: string; interactionId: string; interactionToken: string; applicationId: string; channelId: string }
export interface ReadInteractionDeps {
  enqueue: (input: PendingConversationMessage) => Promise<void>;
}
export async function handleReadInteraction(interaction: ChatInputCommandInteraction, deps: ReadInteractionDeps): Promise<void>
// 1. username = interaction.options.getString('username', true).trim()
// 2. await interaction.reply(\`Fetching conversation for @\${username}... ⏳\`) — the literal pending text (decision #12)
// 3. empty username → await interaction.editReply('Please provide a VGen username, e.g. /read ErianOsamu.'); return
// 4. try { await deps.enqueue({ clientUsername: username, interactionId: interaction.id,
//        interactionToken: interaction.token, applicationId: interaction.applicationId, channelId: interaction.channelId }) }
//    catch { await interaction.followUp('Failed to queue the read request. Check the worker logs.'); }

// bot.ts
export interface BotOptions {
  token: string; applicationId: string; guildId?: string;
  commands: unknown[]; onInteraction: (interaction: Interaction) => Promise<void>;
}
export interface BotHandle { stop(): Promise<void> }
export async function startDiscordBot(options: BotOptions): Promise<BotHandle>
// Client({ intents: [GatewayIntentBits.Guilds] }); 'ready' log; 'interactionCreate' → onInteraction wrapped in catch+log;
// await client.login(token); stop = () => client.destroy()
export async function registerSlashCommands(rest: REST, options: { applicationId: string; guildId?: string; commands: unknown[] }): Promise<void>
// await rest.put(guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId), { body: commands })
export function createInteractionRouter(handlers: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>>): (interaction: Interaction) => Promise<void>
// skip when !interaction.isChatInputCommand(); dispatch by interaction.commandName; unknown name ignored;
// handler rejections are caught + logged, never rethrown
```

- [ ] **Step 1: Write the failing tests**
  - Extend `client.test.ts` (stub `DiscordRestLike` capturing `patch` + `post`): `editInteractionFollowup` hits `/webhooks/{appId}/{token}/messages/@original` with `{ content }`; a 404-shaped rethrow resolves `{ messageId: null }`; `sendChannelMessage` posts to `/channels/{id}/messages`.
  - `read.test.ts`: `formatConversationPreview` — 6 messages → header says "latest 5" and shows only the newest 5; 2,500-char bodies → emitted string length ≤ 2000 (Review Focus #4); `sentAt: null` message shows "time unknown". `handleReadInteraction` with a fake interaction object (typed `as unknown as ChatInputCommandInteraction` with spies): replies with the exact `Fetching conversation for @ErianOsamu... ⏳`; calls `enqueue` with username/interactionId/token/applicationId/channelId; enqueue throwing → `followUp` called with the failure text; never throws itself.
  - `bot.test.ts` (no network): `createInteractionRouter` routes a fake `{ isChatInputCommand: () => true, commandName: 'read' }`; ignores non-chat-input + unknown command; a rejecting handler is caught.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/discord`
Expected: FAIL.

- [ ] **Step 3: Implement** the four files → tests pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/discord && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discord
git commit -m "feat(discord): /read command, interaction followup messenger, gateway bot helpers"
```

---

### Task 9: Worker — `READ_VGEN_CONVERSATION` handler + BROWSER consumer wiring

**Files:**
- Create: `apps/worker/src/handlers/readVgenConversation.ts`, `apps/worker/src/services/vgen.ts`
- Modify: `apps/worker/src/index.ts` (BROWSER consumer + `closeSharedBrowserContext()` in `shutdownAndExit`)
- Modify: `apps/worker/src/services/discord.ts` (`DiscordNotifierDeps` gains `messenger: DiscordMessenger`)
- Modify: `apps/worker/package.json` (deps: `@client-agent/browser`, `@client-agent/platform`, `@client-agent/vgen`)
- Test: `apps/worker/tests/readVgenConversation.test.ts` (new)

**Interfaces:**
- Consumes: `PlatformAdapter`/`ConversationResult` (Task 3); `VGenBrowserAdapter` (Task 6); `insertMessagesIfNew`/`upsertConversation`/`touchConversationLastSynced`/`getConversationWithClient`/`insertAuditLog` (Task 2); `upsertClient` + `getOwnerUserId` (existing); `NonRetriableError` (Task 7); `DiscordMessenger`, `formatConversationPreview` (Task 8).
- Produces (exact — Task 10 consumes):

```ts
// handlers/readVgenConversation.ts
export interface ReadVgenTaskInput {
  clientUsername: string;
  requestedBy?: 'discord' | 'api' | 'web';
  discord?: { interactionId?: string; interactionToken?: string; applicationId?: string; channelId?: string };
}
export interface ReadVgenOutput {
  conversationId: number; conversationExternalId: string; externalUrl: string; clientId: number;
  messagesReceived: number; messagesNew: number;
  deliveredVia: 'interaction' | 'channel' | 'none'; deliveryError?: string;
}
export interface ReadVgenDeps {
  adapter: Pick<PlatformAdapter, 'getConversation'>;
  messenger?: DiscordMessenger | null;
}
export async function runConversationRead(input: ReadVgenTaskInput, taskId: number, deps: ReadVgenDeps): Promise<ReadVgenOutput>
export async function handleReadVgenConversation(task: ParsedTask, deps: ReadVgenDeps): Promise<ReadVgenOutput>
export async function handleSyncConversation(task: ParsedTask, deps: ReadVgenDeps): Promise<ReadVgenOutput>
```

Behavior (mirroring `handleNotifyDiscord` conventions):

1. Parse `taskId` from `task.data.taskId` (NaN → throw `'message missing taskId'`); `getTaskById`; if already `COMPLETED` return its output as-is (idempotent re-run); `isStandalone` guard — call `markTaskRunning` only when the task was not `RUNNING` (same pattern as `handleNotifyDiscord`).
2. `handleSyncConversation` resolves input `{ conversationId }` → `getConversationWithClient(id)`; missing → throw `'SYNC_CONVERSATION input missing conversation'`; then rebuild the input as `{ clientUsername, requestedBy: 'api' }` and delegate to `runConversationRead`.
3. `runConversationRead` core:
   - `result = await adapter.getConversation({ clientUsername: input.clientUsername })`.
   - Catch `SessionExpiredError` → `insertAuditLog({ actorType: 'agent', action: 'SESSION_EXPIRED', targetType: 'task', targetId: taskId, metadata: { clientUsername } })`; when `messenger` and `input.discord.channelId` → `messenger.sendChannelMessage(input.discord.channelId, '⚠️ VGen session has expired! Please log in via browser profile to resume automation.')` (best-effort try/catch); then `throw new NonRetriableError('VGen session expired — awaiting manual re-auth')`.
   - Catch `ClientNotFoundError` → `throw new NonRetriableError(e.message)` (no retry value).
   - Persist: `client = await upsertClient({ userId: ownerId, platform: 'vgen', username: input.clientUsername })` (ownerId = `getOwnerUserId()`); `conversation = await upsertConversation({ clientId: client.id, platform: 'vgen', externalId: result.externalId, externalUrl: result.externalUrl })`; `messagesNew = await insertMessagesIfNew(conversation.id, result.messages.map(m => ({ externalId: m.externalId, direction: m.direction, senderType: m.direction === 'inbound' ? 'client' : 'creator', senderName: m.senderName, content: m.content, sentAt: m.sentAt, metadata: { sentAtRaw: m.sentAtRaw ?? null } })))`; `await touchConversationLastSynced(conversation.id)`; `await insertAuditLog({ actorType: 'agent', action: 'AGENT_READ_CONVERSATION', targetType: 'conversation', targetId: conversation.id, metadata: { messagesNew, requestedBy: input.requestedBy ?? 'api' } })`.
   - Deliver (only when `input.requestedBy === 'discord'`): `content = formatConversationPreview(result.clientUsername, result.messages.slice(-5))`; when `input.discord.interactionToken` and `input.discord.applicationId` → try `messenger.editInteractionFollowup(...)` → `deliveredVia: 'interaction'`; else when `input.discord.channelId` → `messenger.sendChannelMessage(input.discord.channelId, content)` → `'channel'`; send failure → `output.deliveryError = String(err)` but completion continues (decision #11). No messenger/channel/id → `'none'`.
   - Return the full `ReadVgenOutput`; the caller (`handle*`) marks the task completed with this output when standalone.
4. Both handlers wrap errored paths with `markTaskFailed(taskId, message)` when standalone, then rethrow so `runTask` drives backoff/dead-lettering.
- [ ] **Step 1: Write the failing handler test** (style of `apps/worker/tests/notifyDiscord.test.ts` — seeded DB rows, stubbed adapter + messenger):
  1. Success: stub adapter returns a 3-message `ConversationResult` → client + conversation + exactly 3 message rows persist; `lastSyncedAt` non-null; audit row `AGENT_READ_CONVERSATION` exists; output reports `messagesNew: 3`.
  2. Rerun with updated adapter output (2 shared + 2 new messages) → `messagesNew: 2`, no duplicate rows, same conversation id (Review Focus #1).
  3. `SessionExpiredError`: stub adapter rejects → messenger stub received `'⚠️ VGen session has expired! Please log in via browser profile to resume automation.'` exactly once; audit row with action `SESSION_EXPIRED`; handler rejects with `NonRetriableError` (message contains 'awaiting manual re-auth' — the runner pins DEAD with zero retries, Task 6/7 own that; Review Focus #3).
  4. `ClientNotFoundError` → rejects with `NonRetriableError`.
  5. Delivery failure: `editInteractionFollowup` rejects → output `deliveryError` set and NO task failure; preview content came from `formatConversationPreview` (exact header present).
  6. 40-message adapter result with `requestedBy: 'discord'` + token → preview sent for exactly the newest 5.
  7. `handleSyncConversation` with seeded conversation → resolves username from DB and produces the same persistence flow; unknown `conversationId` → plain `Error` thrown (runner retries it — data may reappear).
- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/readVgenConversation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the handler + `services/vgen.ts`:

```ts
// services/vgen.ts
export interface VgenWorkerDeps { adapter: VGenBrowserAdapter; messenger: DiscordMessenger | null }
export async function resolveVgenWorkerDeps(): Promise<VgenWorkerDeps>
// adapter: module-level lazy singleton new VGenBrowserAdapter() (packages/browser reads config profile path);
// messenger: config.DISCORD_BOT_TOKEN ? createDiscordNotifier({ token }) : null
```
Then extend `apps/worker/src/services/discord.ts` to also return `messenger` in `DiscordNotifierDeps` (same factory object implements both interfaces). Wire the consumer in `apps/worker/src/index.ts`:

```ts
{
  stream: STREAMS.BROWSER,
  handler: async (task) => {
    const deps = await resolveVgenWorkerDeps();
    const type = task.data.type;
    if (type !== String(TaskType.READ_VGEN_CONVERSATION) && type !== String(TaskType.SYNC_CONVERSATION)) {
      throw new Error(`BROWSER stream received unsupported task type: ${type}`);
    }
    return type === String(TaskType.SYNC_CONVERSATION)
      ? handleSyncConversation(task, deps)
      : handleReadVgenConversation(task, deps);
  },
},
```
Add `await closeSharedBrowserContext()` in `shutdownAndExit()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/worker && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): READ_VGEN_CONVERSATION handler with dedupe, session alert, Discord preview"
```

---

### Task 10: Worker bot startup — opens the `/read` pipeline

**Files:**
- Create: `apps/worker/src/bot.ts`
- Modify: `apps/worker/src/index.ts` (start `startWorkerDiscordBot`; `stop()` in `shutdownAndExit` before redis disconnect)
- Test: `apps/worker/tests/worker-bot.test.ts` (new)

**Interfaces:**
- Consumes: `startDiscordBot`, `registerSlashCommands`, `createInteractionRouter`, `READ_COMMAND`, `handleReadInteraction`, `ReadInteractionDeps` (Task 8); `createTask`, `getOwnerUserId`, `publishTask` (existing).
- Produces (exact — used only inside the worker):

```ts
export interface ReadEnqueuerOptions { publisher?: (stream: string, payload: Record<string, unknown>) => Promise<string> }
export async function resolveReadEnqueuer(options?: ReadEnqueuerOptions): Promise<ReadInteractionDeps['enqueue'] | null>
// null when config.DISCORD_BOT_TOKEN is missing (no bot → no enqueue path);
// else: ownerId = await getOwnerUserId(); publisher = options?.publisher ?? publishTask;
// enqueue: const task = await createTask({ userId: ownerId, type: TaskType.READ_VGEN_CONVERSATION,
//   input: { clientUsername, requestedBy: 'discord',
//            discord: { interactionId, interactionToken, applicationId, channelId } },
//   idempotencyKey: `read_vgen:${clientUsername}:${interactionId}` });   // decision #13
// await publisher(STREAMS.BROWSER, { type: TaskType.READ_VGEN_CONVERSATION, taskId: String(task.id) });
export async function startWorkerDiscordBot(options?: ReadEnqueuerOptions): Promise<BotHandle | null>
// null when token OR config.DISCORD_APPLICATION_ID missing;
// const rest = new REST({ version: '10' }).setToken(token);
// await registerSlashCommands(rest, { applicationId, guildId: config.DISCORD_GUILD_ID, commands: [READ_COMMAND] });
// await startDiscordBot({ token, applicationId, guildId, commands: [READ_COMMAND],
//   onInteraction: createInteractionRouter({ read: (i) => handleReadInteraction(i, { enqueue }) }) })
```

- [ ] **Step 1: Write the failing test**
  1. Token unset → `resolveReadEnqueuer()` returns `null`.
  2. Token set → enqueue → exactly one `READ_VGEN_CONVERSATION` task row exists with the full `discord` meta block and `idempotencyKey === 'read_vgen:<username>:<interactionId>'`; publisher stub received `STREAMS.BROWSER` + `{ type, taskId }`.
  3. Same `interactionId` enqueued twice → second call returns the SAME task id as the first (findTaskByIdempotencyKey path), publisher may be called twice — no duplicate task rows (Review Focus #2-adjacent: idempotent enqueue).
  4. `startWorkerDiscordBot` without `DISCORD_APPLICATION_ID` → resolves `null` without registering anything.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/worker-bot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `apps/worker/src/bot.ts` + index.ts wiring (start after the existing `resolveDiscordNotifier()` check resolves; keep the handle; `stop()` first in `shutdownAndExit`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/worker && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): discord gateway bot enqueues READ_VGEN_CONVERSATION from /read"
```

---

### Task 11: API — `POST /conversations/sync` + `POST /conversations/:id/sync` (+ stream remap)

**Files:**
- Create: `apps/api/src/routes/conversations.ts`
- Modify: `apps/api/src/app.ts` (`.use(createConversationRoutes())` — factory style like `createTaskRoutes`)
- Modify: `apps/api/src/routes/tasks.ts` (`getStreamForTaskType`: `case TaskType.SYNC_CONVERSATION:` moves to the `STREAMS.BROWSER` branch, inline comment: browser work must stay serialized on one profile)
- Test: `apps/api/tests/conversations.test.ts` (new)

**Interfaces:**
- Consumes: `createTask` + `getStreamForTaskType` (modified), `STreams`/`publishTask` (DI like `createTaskRoutes`).
- Produces:

```ts
export interface ConversationRoutesDeps { publishTask?: (stream: string, payload: Record<string, unknown>) => Promise<string> }
export function createConversationRoutes(deps?: ConversationRoutesDeps) // prefix '/api/v1/conversations'
// POST /sync (isAuth; body t.Object({ username: t.String({ minLength: 1, maxLength: 255 }) }))
//   const task = await createTask({ userId: currentUser.id, type: TaskType.READ_VGEN_CONVERSATION,
//     input: { clientUsername: username, requestedBy: 'api' },
//     idempotencyKey: `read_vgen:${username}:${crypto.randomUUID()}` });   // decision #13: fresh key per request
//   await publisher(STREAMS.BROWSER, { type: TaskType.READ_VGEN_CONVERSATION, taskId: String(task.id) });
//   set.status = 202; return { taskId: String(task.id), status: 'queued' };
// POST /:id/sync (isAuth) → conversation = await getConversationById(id); !conversation → 404
//   { error: { code: 'NOT_FOUND', message: 'Conversation not found' } };
//   else createTask({ userId, type: TaskType.SYNC_CONVERSATION,
//     input: { conversationId: id, requestedBy: 'api' },
//     idempotencyKey: `sync_conversation:${id}:${crypto.randomUUID()}` }) → publisher(STREAMS.BROWSER, { type: SYNC_CONVERSATION, taskId }) → 202.
```

- [ ] **Step 1: Write the failing API test** (harness/cleanup of `apps/api/tests/tasks-api.test.ts` — cookie via `createSession(ownerId)`, `app.handle(new Request(...))`):
  1. Authed `POST /api/v1/conversations/sync { username: 'ErianOsamu' }` → 202 `{ taskId, status: 'queued' }`; task row type `READ_VGEN_CONVERSATION`, idempotency key starts with `read_vgen:`; publisher stub got `STREAMS.BROWSER`.
  2. Unauthenticated → 401.
  3. Empty username → 422 (TypeBox).
  4. Authed `POST /api/v1/conversations/<seededId>/sync` → 202 + `SYNC_CONVERSATION` row; unknown id → 404.
  5. `getStreamForTaskType(TaskType.SYNC_CONVERSATION) === STREAMS.BROWSER` (decision #5, Review Focus #2).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/conversations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the route file, `app.ts` wiring, `tasks.ts` remap → tests pass.

- [ ] **Step 4: Run the full API suite**

Run: `bun test apps/api && bun run typecheck`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): conversation sync endpoints route VGen tasks through STREAMS.BROWSER"
```

---

### Task 12: One-time login script, npm scripts, docs, manual runbook

**Files:**
- Create: `scripts/setup-browser-session.ts`
- Modify: root `package.json` — scripts: `"browser:auth": "bun run scripts/setup-browser-session.ts"`, `"browser:smoke": "bun run packages/vgen/scripts/smoke-vgen-read.ts"`
- Modify: `.env.example` — comment under `BROWSER_PROFILE_PATH`: prefer an ABSOLUTE path so scripts (repo-root cwd) and the worker (package-dir cwd) share ONE profile directory
- Modify: `docs/PHASES.md` (tick phase-3 checklist) and `AGENTS.md` (status line: Phase 3 COMPLETED, Phase 4 NEXT UP)

**Interfaces:** Consumes everything built so far; produces the operator auth + verification flow (spec's "Verification & Testing Steps").

- [ ] **Step 1: Implement `scripts/setup-browser-session.ts`**

```ts
// launchPersistentContext({ headless: false }) on config.BROWSER_PROFILE_PATH;
// print the RESOLVED profile path and the instruction 'Log in to VGen, then close the browser window.';
// await the browser close event → exit(0). No credentials are ever read, prompted, or stored.
```

- [ ] **Step 2: Run the manual runbook (each step leaves evidence in the commit/PR notes)**

Prereqs: `docker compose -f infrastructure/docker-compose.yml up -d postgres redis`; migrations applied (Task 1); `bunx playwright install chromium` done (Task 4).

1. `bun run browser:auth` → non-headless window opens on the resolved profile; log into VGen manually; close the window.
2. `bun run browser:smoke -- ErianOsamu` → prints a `ConversationResult` JSON with ≥1 message. Failure here = go back to Task 6 calibration (selectors only), never continue.
3. Start `bun --filter=@client-agent/worker dev` and `bun --filter=@client-agent/api dev`. Login and sync:
   ```bash
   curl -c /tmp/opencode/cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
     -H 'Content-Type: application/json' -d '{"username":"<AUTH_USERNAME>","password":"<the plaintext matching AUTH_PASSWORD_HASH>"}'
   curl -b /tmp/opencode/cookies.txt -X POST http://localhost:3001/api/v1/conversations/sync \
     -H 'Content-Type: application/json' -d '{"username":"ErianOsamu"}'
   curl -b /tmp/opencode/cookies.txt http://localhost:3001/api/v1/agent/tasks/<taskId>   # → status 'completed'
   ```
4. Postgres check: `conversations` has 1 row for the thread; re-running step 3's sync leaves the `messages` row count UNCHANGED while `last_synced_at` moves forward (Review Focus #1).
5. Discord: with `DISCORD_BOT_TOKEN` + `DISCORD_APPLICATION_ID` (and optional `DISCORD_GUILD_ID`) set, restart the worker, run `/read ErianOsamu` in the guild → immediate `"Fetching conversation for @ErianOsamu... ⏳"` reply, then the ORIGINAL message is edited into the ≤5-message preview.
6. Expired-session simulation: point `BROWSER_PROFILE_PATH` at an empty temp dir, restart the worker, `/read ErianOsamu` → Discord alert `'⚠️ VGen session has expired!...'`, task goes `dead` (error mentions re-auth), and NO backoff retries run. Restore the env afterwards.
7. `POST /api/v1/agent/tasks/<deadTaskId>/retry` (existing endpoint) after re-auth → task re-runs and completes (recovery path).

- [ ] **Step 3: Final green check + docs**

```bash
bun test && bun run typecheck
```
Expected: all green; tick the phase-3 checkboxes in `docs/PHASES.md`; flip the `AGENTS.md` status; `.env.example` comment in place.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json .env.example docs/PHASES.md AGENTS.md
git commit -m "docs(phase3): browser auth helper, npm scripts, runbook, phase status"
```

---

## Done When (mirrors the spec checklist + PHASES.md)

- `packages/platform` cleanly decouples domain logic from browser automation (Task 3).
- `packages/vgen` retrieves real conversation messages for a specified username (Tasks 5–6 + smoke calibration).
- Retrieved messages persist to PostgreSQL without duplicates on repeated reads (Tasks 1–2, 9; runbook step 4).
- Session expiry is detected, triggers an alert, and pauses gracefully — DEAD without a retry storm (Tasks 6–9; runbook step 6).
- Discord `/read <username>` returns the latest messages directly in the channel (Tasks 8, 10; runbook step 5).
- Per `AGENTS.md` §2, no external-write capability ships in this phase — `PlatformAdapter.sendMessage` throws `NotSupportedError` until phase 6.
