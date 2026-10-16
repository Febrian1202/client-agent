# Phase 2 — Worker System Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the raw Redis Streams consumer into a production-grade, resilient background worker engine featuring a strict task state machine, exponential backoff retries, dead-letter recovery, idempotency enforcement, graceful shutdown, and task observability APIs.

**Architecture:** Tasks transition through a deterministic state machine (`queued` → `running` → `completed` | `failed` → `dead`) managed by a unified `TaskRunner` in `packages/queue`. Transient failures are scheduled into a Redis sorted-set (`client-agent:retry_tasks`) with bounded exponential backoff (`2s`, `10s`, `30s`, `60s`) and ACKed from the stream; a lightweight polling loop pops due items back to their target stream. Orphaned messages from crashed workers are reclaimed on boot via Redis `XAUTOCLAIM`. Process exit signals (`SIGTERM`/`SIGINT`) trigger a 15-second graceful drain of active tasks before exiting cleanly. REST endpoints under `/api/v1/agent/tasks` expose task status and allow manual retry of dead jobs.

**Tech Stack:** Bun, TypeScript (strict), Elysia + TypeBox, Drizzle ORM 0.39 + `postgres.js`, Redis Streams & Sorted Sets (`ioredis`), `bun:test`.

**Spec:** `docs/phase/phase-2-worker-hardening.md` (read with `docs/DATA_MODEL.md` §agent_tasks, `docs/ARCHITECTURE.md` §Background Worker, `docs/adr/005-queue-first.md`, `docs/adr/006-redis-streams.md`).

## Global Constraints

- Monorepo package boundaries: `@client-agent/domain` remains pure TypeScript without external runtime dependencies.
- `@client-agent/queue` depends on `@client-agent/db` and `@client-agent/domain` to operate the task state machine against PostgreSQL.
- Queue-first invariant (ADR-005 / AGENTS.md §2.4): long-running background tasks belong strictly to `apps/worker`. HTTP handlers only enqueue and return immediately.
- Strict deduplication & idempotency: `agent_tasks.idempotency_key` is unique in PostgreSQL (partial unique index `WHERE idempotency_key IS NOT NULL`). Duplicate task submissions return the existing task ID without re-execution.
- Poison pill prevention: invalid stream payloads or tasks exceeding `max_attempts` must be acknowledged (`XACK`) and marked `dead` in PostgreSQL to prevent infinite consumption loops.
- Graceful shutdown timeout: active jobs are allowed up to 15 seconds to finish before force exit; no new messages are consumed after a shutdown signal.
- All timestamps use `timestamp with time zone` in PostgreSQL; task status values must match `TaskStatus` lowercase string enums (`queued`, `running`, `completed`, `failed`, `dead`).
- All tests must pass with `bun test` and type checks with `bun run typecheck`.

## Review Focus

1. **Malformed stream payload missing taskId or invalid integer** — Worker must log the error and immediately `XACK` the message instead of crashing or looping indefinitely on a poison pill. (Task 3, Step 1)
2. **Task ID in stream payload does not exist in database** — Worker must `XACK` the phantom message and log a warning, rather than failing and re-queueing forever. (Task 3, Step 1)
3. **Manual retry invoked on an already completed or running task** — `POST /api/v1/agent/tasks/:id/retry` must reject with HTTP 400 Bad Request instead of corrupting the running task state. (Task 6, Step 1)
4. **Shutdown signal received while a long job is in-flight** — Worker must wait for the job to complete up to the 15-second grace period without accepting new jobs, and exit cleanly with code 0. (Task 5, Step 1)
5. **Worker crashes right after claiming a pending entry before completing it** — Pending recovery must safely re-claim it on next boot with updated attempt counter, hitting dead-letter if `max_attempts` is reached, preventing infinite crash loops. (Task 4, Step 1)

---

### Task 1: Database Schema Enhancement & Task Queries in `packages/db`

**Files:**
- Modify: `packages/db/src/schema/agent_tasks.ts`
- Modify: `packages/db/src/queries/tasks.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/tasks-phase2.test.ts`

**Interfaces:**
- Consumes: `agentTasks` table, `TaskStatus`, `TaskType`.
- Produces:
  - `markTaskDead(id: number, error: string): Promise<AgentTaskRow>`
  - `markTaskRunningWithAttempt(id: number): Promise<AgentTaskRow>`
  - `resetTaskForRetry(id: number): Promise<AgentTaskRow | null>`
  - `listTasks(options: { page?: number; limit?: number; status?: TaskStatus; type?: TaskType }): Promise<{ tasks: AgentTaskRow[]; total: number; page: number; limit: number }>`
  - Unique index `agent_tasks_idempotency_key_idx` on `agentTasks.idempotencyKey` where not null.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/tests/tasks-phase2.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  getTaskById,
  markTaskRunningWithAttempt,
  markTaskDead,
  resetTaskForRetry,
  listTasks,
} from '../src';
import { TaskStatus, TaskType } from '@client-agent/domain';

describe('Phase 2 agent_tasks database queries', () => {
  const testIds: number[] = [];
  let ownerId: number;

  afterAll(async () => {
    for (const id of testIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
  });

  it('increments attempts and updates started_at with markTaskRunningWithAttempt', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { test: true },
    });
    testIds.push(task.id);

    expect(task.attempts).toBe(0);
    expect(task.status).toBe(TaskStatus.QUEUED);

    const runningTask = await markTaskRunningWithAttempt(task.id);
    expect(runningTask.attempts).toBe(1);
    expect(runningTask.status).toBe(TaskStatus.RUNNING);
    expect(runningTask.startedAt).not.toBeNull();
  });

  it('marks task as dead with error context and completed_at timestamp', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.NOTIFY_DISCORD,
      input: { notify: 1 },
    });
    testIds.push(task.id);

    const deadTask = await markTaskDead(task.id, 'Fatal poison pill error');
    expect(deadTask.status).toBe(TaskStatus.DEAD);
    expect(deadTask.error).toBe('Fatal poison pill error');
    expect(deadTask.completedAt).not.toBeNull();
  });

  it('resets a failed/dead task for retry with resetTaskForRetry', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { retry: true },
    });
    testIds.push(task.id);
    await markTaskDead(task.id, 'Crash');

    const resetTask = await resetTaskForRetry(task.id);
    expect(resetTask).not.toBeNull();
    expect(resetTask!.status).toBe(TaskStatus.QUEUED);
    expect(resetTask!.attempts).toBe(0);
    expect(resetTask!.error).toBeNull();
    expect(resetTask!.startedAt).toBeNull();
    expect(resetTask!.completedAt).toBeNull();
  });

  it('lists tasks with pagination and status filter', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.SYNC_CONVERSATION,
      input: { sync: 1 },
    });
    testIds.push(task.id);

    const result = await listTasks({
      page: 1,
      limit: 10,
      type: TaskType.SYNC_CONVERSATION,
    });

    expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/tasks-phase2.test.ts`
Expected: FAIL — `markTaskRunningWithAttempt is not a function`.

- [ ] **Step 3: Update schema and implement queries in `packages/db`**

1. In `packages/db/src/schema/agent_tasks.ts`:
   Add unique index on `idempotencyKey`:
   ```ts
   import { uniqueIndex } from 'drizzle-orm/pg-core';
   // In table definition second argument or table config:
   export const agentTasks = pgTable('agent_tasks', {
     // ... columns ...
   }, (table) => ({
     idempotencyKeyIdx: uniqueIndex('agent_tasks_idempotency_key_idx').on(table.idempotencyKey),
   }));
   ```
2. In `packages/db/src/queries/tasks.ts`:
   Implement:
   - `markTaskRunningWithAttempt(id: number): Promise<AgentTaskRow>`: updates status to `running`, increments attempts (`sql`${agentTasks.attempts} + 1``), sets `startedAt: sql`now()``, returning the updated record.
   - `markTaskDead(id: number, error: string): Promise<AgentTaskRow>`: updates status to `dead`, sets `error`, sets `completedAt: sql`now()``, returning the updated record.
   - `resetTaskForRetry(id: number): Promise<AgentTaskRow | null>`: updates status to `queued`, resets `attempts: 0`, `error: null`, `startedAt: null`, `completedAt: null`, returning the updated record.
   - `listTasks(options: { page?: number; limit?: number; status?: TaskStatus; type?: TaskType })`: runs count query and paginated select query with filters and `orderBy(desc(agentTasks.createdAt))`.
3. Export new functions from `packages/db/src/index.ts`.
4. Run `bun run --filter=@client-agent/db db:push` or apply migration SQL.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/tests/tasks-phase2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add task lifecycle queries and idempotency unique index for phase 2"
```

---

### Task 2: Delayed Retries & Backoff Scheduling in `packages/queue`

**Files:**
- Modify: `packages/queue/package.json`
- Create: `packages/queue/src/retry.ts`
- Modify: `packages/queue/src/constants.ts`
- Modify: `packages/queue/src/index.ts`
- Test: `packages/queue/tests/retry.test.ts`

**Interfaces:**
- Consumes: `Redis` client, `publishTask`.
- Produces:
  - `RETRY_ZSET_KEY`: `'client-agent:retry_tasks'`
  - `calculateBackoffDelay(attempts: number, delays?: number[]): number`
  - `scheduleRetry(redis: Redis, stream: string, payload: Record<string, unknown>, delayMs: number): Promise<void>`
  - `pollDueRetries(redis: Redis, limit?: number): Promise<number>`
  - `clearRetries(redis: Redis): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/queue/tests/retry.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import {
  createRedisClient,
  calculateBackoffDelay,
  scheduleRetry,
  pollDueRetries,
  clearRetries,
  STREAMS,
} from '../src';

describe('Queue Retry and Exponential Backoff Scheduler', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_retry_test_${Date.now()}`;

  afterAll(async () => {
    await clearRetries(redis);
    await redis.del(testStream);
    redis.disconnect();
  });

  it('calculates bounded exponential backoff delay based on attempts', () => {
    expect(calculateBackoffDelay(1)).toBe(2_000);
    expect(calculateBackoffDelay(2)).toBe(10_000);
    expect(calculateBackoffDelay(3)).toBe(30_000);
    expect(calculateBackoffDelay(4)).toBe(60_000);
    expect(calculateBackoffDelay(5)).toBe(60_000); // capped at maximum backoff
  });

  it('allows custom retry backoff delays array', () => {
    const custom = [100, 500, 1000];
    expect(calculateBackoffDelay(1, custom)).toBe(100);
    expect(calculateBackoffDelay(2, custom)).toBe(500);
    expect(calculateBackoffDelay(3, custom)).toBe(1000);
    expect(calculateBackoffDelay(10, custom)).toBe(1000);
  });

  it('schedules a task to retry ZSET and polls it when due', async () => {
    await clearRetries(redis);

    // Schedule task with 50ms delay
    await scheduleRetry(redis, testStream, { taskId: '999', type: 'TEST' }, 50);

    // Polling immediately should find 0 due tasks
    const countImmediate = await pollDueRetries(redis);
    expect(countImmediate).toBe(0);

    // Wait 60ms for task to become due
    await Bun.sleep(60);

    // Polling now should publish to stream and return 1
    const countDue = await pollDueRetries(redis);
    expect(countDue).toBe(1);

    // Verify task arrived in Redis stream
    const entries = await redis.xrange(testStream, '-', '+');
    expect(entries.length).toBe(1);
    expect(entries[0]![1]).toContain('999');

    // Polling again should find 0
    const countAfter = await pollDueRetries(redis);
    expect(countAfter).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/queue/tests/retry.test.ts`
Expected: FAIL — `Cannot find module '../src/retry'`.

- [ ] **Step 3: Implement `packages/queue/src/retry.ts` and export from `src/index.ts`**

1. Define `BACKOFF_DELAYS = [2_000, 10_000, 30_000, 60_000]` and `RETRY_ZSET_KEY = 'client-agent:retry_tasks'`.
2. Implement `calculateBackoffDelay(attempts: number, delays = BACKOFF_DELAYS): number`:
   Index `Math.max(0, attempts - 1)`. If index >= delays.length, return `delays[delays.length - 1]!`.
3. Implement `scheduleRetry(redis, stream, payload, delayMs)`:
   Computes `score = Date.now() + delayMs`. Member is `JSON.stringify({ stream, payload, scheduledAt: Date.now() })`. Calls `redis.zadd(RETRY_ZSET_KEY, score, member)`.
4. Implement `pollDueRetries(redis, limit = 50)`:
   Uses atomic Lua script or transaction: fetch entries with score <= `Date.now()`, remove them from ZSET (`zrem`), parse payload, and call `publishTask(entry.stream, entry.payload)`. Returns number of published tasks.
5. Implement `clearRetries(redis)`: `redis.del(RETRY_ZSET_KEY)`.
6. Export all in `packages/queue/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/queue/tests/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/
git commit -m "feat(queue): add exponential backoff retry scheduler using redis sorted set"
```

---

### Task 3: Task Runner Abstraction & State Machine in `packages/queue`

**Files:**
- Modify: `packages/queue/package.json` (add `@client-agent/db` and `@client-agent/domain`)
- Create: `packages/queue/src/runner.ts`
- Modify: `packages/queue/src/index.ts`
- Test: `packages/queue/tests/runner.test.ts`

**Interfaces:**
- Consumes: `Redis`, `ParsedTask`, `getTaskById`, `markTaskRunningWithAttempt`, `markTaskCompleted`, `markTaskFailed`, `markTaskDead`, `scheduleRetry`, `calculateBackoffDelay`.
- Produces:
  - `runTask(options: RunTaskOptions): Promise<TaskExecutionResult>`
  - Types: `TaskExecutionResult`, `RunTaskOptions`, `TaskHandler`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/queue/tests/runner.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  getTaskById,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import {
  createRedisClient,
  createConsumerGroupIfNotExists,
  publishTask,
  runTask,
  clearRetries,
  STREAMS,
} from '../src';

describe('Task Runner State Machine', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_runner_${Date.now()}`;
  const testGroup = 'runner_group';
  const createdTaskIds: number[] = [];
  let ownerId: number;

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
    await clearRetries(redis);
    await redis.del(testStream);
    redis.disconnect();
  });

  it('handles success: transitions to completed, updates output, and ACKs message', async () => {
    ownerId = await getOwnerUserId();
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);

    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { foo: 'bar' },
    });
    createdTaskIds.push(task.id);

    const messageId = await publishTask(testStream, { taskId: String(task.id) });

    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: messageId, data: { taskId: String(task.id) } },
      handler: async () => ({ processed: true }),
    });

    expect(result.status).toBe('completed');
    const updated = await getTaskById(task.id);
    expect(updated!.status).toBe(TaskStatus.COMPLETED);
    expect(updated!.output).toEqual({ processed: true });
    expect(updated!.attempts).toBe(1);

    // Verify ACKed (no pending items)
    const pending = await redis.xpending(testStream, testGroup);
    expect(pending[0]).toBe(0);
  });

  it('handles transient error: marks failed, schedules retry backoff, and ACKs stream entry', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { errorTest: true },
    });
    createdTaskIds.push(task.id);

    const messageId = await publishTask(testStream, { taskId: String(task.id) });

    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: messageId, data: { taskId: String(task.id) } },
      retryDelays: [50, 100],
      handler: async () => {
        throw new Error('Transient network glitch');
      },
    });

    expect(result.status).toBe('retried');
    const updated = await getTaskById(task.id);
    expect(updated!.status).toBe(TaskStatus.FAILED);
    expect(updated!.error).toBe('Transient network glitch');
    expect(updated!.attempts).toBe(1);
  });

  it('handles dead-letter: marks dead when attempts reach max_attempts and ACKs message', async () => {
    ownerId = await getOwnerUserId();
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { deadTest: true },
    });
    createdTaskIds.push(task.id);

    // Manually set attempts to 4 with maxAttempts 5
    await db.update(agentTasks).set({ attempts: 4, maxAttempts: 5 }).where(eq(agentTasks.id, task.id));

    const messageId = await publishTask(testStream, { taskId: String(task.id) });

    let deadLetterAlertTriggered = false;
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: messageId, data: { taskId: String(task.id) } },
      onDeadLetter: async () => {
        deadLetterAlertTriggered = true;
      },
      handler: async () => {
        throw new Error('Fatal unrecoverable failure');
      },
    });

    expect(result.status).toBe('dead');
    expect(deadLetterAlertTriggered).toBeTrue();
    const updated = await getTaskById(task.id);
    expect(updated!.status).toBe(TaskStatus.DEAD);
    expect(updated!.error).toBe('Fatal unrecoverable failure');
    expect(updated!.attempts).toBe(5);

    // Verify ACKed (stream not poisoned)
    const pending = await redis.xpending(testStream, testGroup);
    expect(pending[0]).toBe(0);
  });

  it('safely ACKs and skips invalid stream payload without crashing (Review Focus #1)', async () => {
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-0', data: {} }, // Missing taskId
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('invalid_payload');
  });

  it('safely ACKs and skips non-existent task ID in database (Review Focus #2)', async () => {
    const result = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: '99999-1', data: { taskId: '99999999' } },
      handler: async () => {},
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/queue/tests/runner.test.ts`
Expected: FAIL — `Cannot find module '../src/runner'`.

- [ ] **Step 3: Implement `packages/queue/src/runner.ts`**

1. Update `packages/queue/package.json` to include dependencies:
   ```json
   "@client-agent/db": "workspace:*",
   "@client-agent/domain": "workspace:*"
   ```
2. Implement `runTask(options)`:
   - Validate `taskId = Number(options.task.data.taskId)`. If invalid: `redis.xack(stream, group, task.id)`, return `{ status: 'skipped', reason: 'invalid_payload' }`.
   - Query DB `taskRow = await getTaskById(taskId)`. If not found: `redis.xack(stream, group, task.id)`, return `{ status: 'skipped', reason: 'not_found' }`.
   - If `taskRow.status === TaskStatus.COMPLETED`: `redis.xack(stream, group, task.id)`, return `{ status: 'skipped', reason: 'already_completed' }`.
   - If `taskRow.status === TaskStatus.DEAD`: `redis.xack(stream, group, task.id)`, return `{ status: 'skipped', reason: 'already_dead' }`.
   - Mark running: `const runningTask = await markTaskRunningWithAttempt(taskId)`.
   - Try: `const output = await options.handler(options.task);`
     - On success:
       - `await markTaskCompleted(taskId, (output as Record<string, unknown>) ?? {})`.
       - `await redis.xack(options.stream, options.group, options.task.id)`.
       - Return `{ status: 'completed', output }`.
   - Catch (`err`):
     - `const errorMsg = err instanceof Error ? err.message : String(err)`.
     - If `runningTask.attempts < runningTask.maxAttempts`:
       - `await markTaskFailed(taskId, errorMsg)`.
       - `const delay = calculateBackoffDelay(runningTask.attempts, options.retryDelays)`.
       - `await scheduleRetry(redis, options.stream, options.task.data, delay)`.
       - `await redis.xack(options.stream, options.group, options.task.id)`.
       - Return `{ status: 'retried', attempts: runningTask.attempts, delayMs: delay }`.
     - Else:
       - `await markTaskDead(taskId, errorMsg)`.
       - `await redis.xack(options.stream, options.group, options.task.id)`.
       - If `options.onDeadLetter` provided, await it.
       - Return `{ status: 'dead', attempts: runningTask.attempts, error: errorMsg }`.
3. Export from `packages/queue/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/queue/tests/runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/
git commit -m "feat(queue): implement robust task runner with state machine and dead-letter protection"
```

---

### Task 4: Idempotency Key Guard in `packages/queue`

**Files:**
- Create: `packages/queue/src/idempotency.ts`
- Modify: `packages/queue/src/index.ts`
- Test: `packages/queue/tests/idempotency.test.ts`

**Interfaces:**
- Consumes: `db`, `findTaskByIdempotencyKey`, `createTask`.
- Produces:
  - `checkAndClaimIdempotency(database: typeof db, idempotencyKey: string): Promise<{ canExecute: boolean; existingTask: AgentTaskRow | null }>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/queue/tests/idempotency.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  markTaskCompleted,
  markTaskRunningWithAttempt,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { checkAndClaimIdempotency } from '../src/idempotency';

describe('Idempotency Key Guard', () => {
  const createdTaskIds: number[] = [];
  let ownerId: number;

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
  });

  it('allows execution when no task exists with the idempotency key', async () => {
    const key = `idemp_test_new_${Date.now()}`;
    const claim = await checkAndClaimIdempotency(db, key);
    expect(claim.canExecute).toBeTrue();
    expect(claim.existingTask).toBeNull();
  });

  it('rejects execution when a completed task exists with the same key', async () => {
    ownerId = await getOwnerUserId();
    const key = `idemp_test_done_${Date.now()}`;
    const task = await createTask({
      userId: ownerId,
      type: TaskType.NOTIFY_DISCORD,
      input: { done: true },
      idempotencyKey: key,
    });
    createdTaskIds.push(task.id);
    await markTaskCompleted(task.id, { ack: true });

    const claim = await checkAndClaimIdempotency(db, key);
    expect(claim.canExecute).toBeFalse();
    expect(claim.existingTask!.id).toBe(task.id);
    expect(claim.existingTask!.status).toBe(TaskStatus.COMPLETED);
  });

  it('rejects execution when a currently running task exists with the same key', async () => {
    ownerId = await getOwnerUserId();
    const key = `idemp_test_running_${Date.now()}`;
    const task = await createTask({
      userId: ownerId,
      type: TaskType.NOTIFY_DISCORD,
      input: { running: true },
      idempotencyKey: key,
    });
    createdTaskIds.push(task.id);
    await markTaskRunningWithAttempt(task.id);

    const claim = await checkAndClaimIdempotency(db, key);
    expect(claim.canExecute).toBeFalse();
    expect(claim.existingTask!.id).toBe(task.id);
    expect(claim.existingTask!.status).toBe(TaskStatus.RUNNING);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/queue/tests/idempotency.test.ts`
Expected: FAIL — `Cannot find module '../src/idempotency'`.

- [ ] **Step 3: Implement `packages/queue/src/idempotency.ts`**

```ts
import type { AgentTaskRow, db } from '@client-agent/db';
import { findTaskByIdempotencyKey } from '@client-agent/db';
import { TaskStatus } from '@client-agent/domain';

export interface IdempotencyClaimResult {
  canExecute: boolean;
  existingTask: AgentTaskRow | null;
}

export async function checkAndClaimIdempotency(
  database: typeof db,
  idempotencyKey: string,
): Promise<IdempotencyClaimResult> {
  const existing = await findTaskByIdempotencyKey(idempotencyKey);
  if (!existing) {
    return { canExecute: true, existingTask: null };
  }

  if (existing.status === TaskStatus.COMPLETED || existing.status === TaskStatus.RUNNING) {
    return { canExecute: false, existingTask: existing };
  }

  return { canExecute: true, existingTask: existing };
}
```
Export from `packages/queue/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/queue/tests/idempotency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/
git commit -m "feat(queue): implement checkAndClaimIdempotency guard"
```

---

### Task 5: Crash Resilience & Pending Entries Recovery in `packages/queue`

**Files:**
- Create: `packages/queue/src/recovery.ts`
- Modify: `packages/queue/src/index.ts`
- Test: `packages/queue/tests/recovery.test.ts`

**Interfaces:**
- Consumes: `Redis`, `ParsedTask`.
- Produces:
  - `recoverPendingTasks(options: RecoverPendingOptions): Promise<ParsedTask[]>`
  - Types: `RecoverPendingOptions`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/queue/tests/recovery.test.ts
import { describe, expect, it, afterAll } from 'bun:test';
import {
  createRedisClient,
  createConsumerGroupIfNotExists,
  publishTask,
  consumeNextTask,
  recoverPendingTasks,
  STREAMS,
} from '../src';

describe('Crash Resilience - Pending Entries Recovery', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_recovery_${Date.now()}`;
  const testGroup = 'recovery_group';
  const deadWorker = 'dead_worker_pid_123';
  const newWorker = 'recovering_worker_pid_456';

  afterAll(async () => {
    await redis.del(testStream);
    redis.disconnect();
  });

  it('claims orphaned unacknowledged messages after minIdleTime (Review Focus #5)', async () => {
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);

    // 1. Dead worker consumes a task but crashes before ACK
    const messageId = await publishTask(testStream, { taskId: '555', payload: 'crash-data' });
    const consumed = await consumeNextTask(redis, {
      stream: testStream,
      group: testGroup,
      consumer: deadWorker,
      blockMs: 1000,
    });
    expect(consumed).not.toBeNull();
    expect(consumed!.id).toBe(messageId);

    // Check pending count is 1
    const pendingBefore = await redis.xpending(testStream, testGroup);
    expect(pendingBefore[0]).toBe(1);

    // 2. Recovery runs immediately with minIdleTimeMs: 100 (should not claim yet)
    const claimedEarly = await recoverPendingTasks({
      redis,
      stream: testStream,
      group: testGroup,
      consumer: newWorker,
      minIdleTimeMs: 100,
    });
    expect(claimedEarly.length).toBe(0);

    // Wait 120ms to exceed idle time
    await Bun.sleep(120);

    // 3. New worker recovers orphaned tasks
    const claimed = await recoverPendingTasks({
      redis,
      stream: testStream,
      group: testGroup,
      consumer: newWorker,
      minIdleTimeMs: 100,
    });

    expect(claimed.length).toBe(1);
    expect(claimed[0]!.id).toBe(messageId);
    expect(claimed[0]!.data.taskId).toBe('555');

    // Clean up ACK
    await redis.xack(testStream, testGroup, messageId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/queue/tests/recovery.test.ts`
Expected: FAIL — `Cannot find module '../src/recovery'`.

- [ ] **Step 3: Implement `packages/queue/src/recovery.ts`**

```ts
import type { Redis } from './index';
import type { ParsedTask } from './consumer';

export interface RecoverPendingOptions {
  redis: Redis;
  stream: string;
  group: string;
  consumer: string;
  minIdleTimeMs?: number; // default: 300_000 (5 minutes)
  batchSize?: number; // default: 20
}

export async function recoverPendingTasks(options: RecoverPendingOptions): Promise<ParsedTask[]> {
  const { redis, stream, group, consumer, minIdleTimeMs = 300_000, batchSize = 20 } = options;
  const claimedTasks: ParsedTask[] = [];

  let startId = '0-0';
  do {
    // XAUTOCLAIM stream group consumer min-idle-time start [COUNT count]
    const rawResult = await redis.xautoclaim(
      stream,
      group,
      consumer,
      minIdleTimeMs,
      startId,
      'COUNT',
      batchSize,
    );

    const [nextId, entries] = rawResult as [string, [string, string[]][], string[]];
    startId = nextId;

    if (Array.isArray(entries)) {
      for (const [id, fields] of entries) {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]!] = fields[i + 1]!;
        }
        claimedTasks.push({ id, data });
      }
    }

    if (startId === '0-0' || !entries || entries.length === 0) {
      break;
    }
  } while (claimedTasks.length < 100);

  return claimedTasks;
}
```
Export from `packages/queue/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/queue/tests/recovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/
git commit -m "feat(queue): implement XAUTOCLAIM pending entries recovery"
```

---

### Task 6: Worker Process Hardening & Graceful Shutdown in `apps/worker`

**Files:**
- Modify: `apps/worker/src/taskHandler.ts`
- Modify: `apps/worker/src/consumers.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/handlers/processGmailEvent.ts`
- Modify: `apps/worker/src/handlers/notifyDiscord.ts`
- Test: `apps/worker/tests/worker-shutdown.test.ts`

**Interfaces:**
- Consumes: `runTask`, `pollDueRetries`, `recoverPendingTasks`, `checkAndClaimIdempotency`.
- Produces:
  - Active jobs counter tracking in `apps/worker/src/consumers.ts`.
  - Background retry polling timer (every 1,000ms).
  - Graceful shutdown logic: stop consumer loops, wait up to 15s for in-flight tasks (`activeJobsCounter === 0`), close connections, exit 0.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/tests/worker-shutdown.test.ts
import { describe, expect, it } from 'bun:test';
import { createRedisClient, STREAMS } from '@client-agent/queue';
import { startWorker } from '../src/consumers';

describe('Worker Graceful Shutdown & Active Jobs Tracking (Review Focus #4)', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_shutdown_${Date.now()}`;
  const group = 'shutdown_group';

  it('drains active in-flight jobs cleanly on shutdown', async () => {
    let jobStarted = false;
    let jobFinished = false;

    const worker = await startWorker({
      workerId: 'shutdown-test-worker',
      group,
      redis,
      retryPollIntervalMs: 50,
      consumers: [
        {
          stream: testStream,
          handler: async () => {
            jobStarted = true;
            await Bun.sleep(150);
            jobFinished = true;
          },
        },
      ],
    });

    // Verify active jobs starts at 0
    expect(worker.getActiveJobsCount()).toBe(0);

    // Enqueue message
    await redis.xadd(testStream, '*', 'type', 'TEST', 'taskId', '1');

    // Wait until job starts
    while (!jobStarted) {
      await Bun.sleep(20);
    }
    expect(worker.getActiveJobsCount()).toBe(1);

    // Call shutdown while job is in-flight
    const shutdownPromise = worker.shutdown(2000);
    expect(worker.isShuttingDown()).toBeTrue();

    await shutdownPromise;
    expect(jobFinished).toBeTrue();
    expect(worker.getActiveJobsCount()).toBe(0);

    await redis.del(testStream);
    redis.disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/worker-shutdown.test.ts`
Expected: FAIL — `getActiveJobsCount is not a function`.

- [ ] **Step 3: Update `apps/worker` to integrate runner, recovery, retries, and graceful shutdown**

1. In `apps/worker/src/taskHandler.ts`:
   Use `runTask` from `@client-agent/queue` to handle execution, state transitions, retries, and ACKs.
2. In `apps/worker/src/handlers/processGmailEvent.ts` and `notifyDiscord.ts`:
   Return the result object from handlers without manually duplicating status calls (`markTaskRunning`, `markTaskCompleted`, `markTaskFailed`), while preserving idempotent client upsert and Discord notifications.
3. In `apps/worker/src/consumers.ts`:
   - Add `let activeJobsCount = 0;` and `let isShuttingDown = false;`.
   - On worker start, iterate consumers and call `recoverPendingTasks` to re-process pending tasks from dead workers.
   - Start retry poller: `setInterval(() => pollDueRetries(redis), options.retryPollIntervalMs ?? 1000)`.
   - In consumer loop: increment `activeJobsCount` when task processing begins, decrement in `finally`.
   - In `shutdown(timeoutMs = 15000)`:
     - Set `isShuttingDown = true`.
     - Stop retry interval and heartbeat interval.
     - Poll until `activeJobsCount === 0` or timeout reached:
       ```ts
       const start = Date.now();
       while (activeJobsCount > 0 && Date.now() - start < timeoutMs) {
         await Bun.sleep(50);
       }
       ```
     - Return `{ getActiveJobsCount: () => activeJobsCount, isShuttingDown: () => isShuttingDown, shutdown }`.
4. In `apps/worker/src/index.ts`:
   Connect `SIGTERM` and `SIGINT` to call `await shutdown(15000)`, close Redis and DB, and call `process.exit(0)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/worker/tests/worker-shutdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Run existing worker tests to verify no regressions**

Run: `bun test apps/worker/`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/
git commit -m "feat(worker): implement graceful shutdown, active job tracking, and runner integration"
```

---

### Task 7: Task Observability & Manual Retry APIs in `apps/api`

**Files:**
- Create: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/tasks-api.test.ts`

**Interfaces:**
- Consumes: `listTasks`, `getTaskById`, `resetTaskForRetry`, `publishTask`, `authPlugin`.
- Produces:
  - `GET /api/v1/agent/tasks` (with filters `?status=`, `?type=`, and pagination `?page=`, `?limit=`)
  - `GET /api/v1/agent/tasks/:id`
  - `POST /api/v1/agent/tasks/:id/retry`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/tasks-api.test.ts
import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  markTaskDead,
  markTaskCompleted,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { app } from '../src/app';
import { createSession } from '../src/auth/session';

describe('Task Observability & Retry API Endpoints', () => {
  const createdTaskIds: number[] = [];
  let cookieHeader: string;
  let ownerId: number;

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;
  });

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
  });

  it('GET /api/v1/agent/tasks requires authentication', async () => {
    const res = await app.handle(new Request('http://localhost/api/v1/agent/tasks'));
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/agent/tasks returns paginated tasks with filters', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { apiTest: true },
    });
    createdTaskIds.push(task.id);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/agent/tasks?status=${TaskStatus.QUEUED}&page=1&limit=10`, {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toBeArray();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/agent/tasks/:id returns task detail', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.NOTIFY_DISCORD,
      input: { detail: 1 },
    });
    createdTaskIds.push(task.id);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/agent/tasks/${task.id}`, {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe(task.id);
    expect(body.task.type).toBe(TaskType.NOTIFY_DISCORD);
  });

  it('POST /api/v1/agent/tasks/:id/retry resets failed/dead task and re-queues', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { retry: true },
    });
    createdTaskIds.push(task.id);
    await markTaskDead(task.id, 'Test failure');

    const res = await app.handle(
      new Request(`http://localhost/api/v1/agent/tasks/${task.id}/retry`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.status).toBe(TaskStatus.QUEUED);
    expect(body.task.attempts).toBe(0);
    expect(body.task.error).toBeNull();
  });

  it('POST /api/v1/agent/tasks/:id/retry rejects completed task with 400 (Review Focus #3)', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { cannotRetry: true },
    });
    createdTaskIds.push(task.id);
    await markTaskCompleted(task.id, { ok: true });

    const res = await app.handle(
      new Request(`http://localhost/api/v1/agent/tasks/${task.id}/retry`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TASK_STATE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/tasks-api.test.ts`
Expected: FAIL — 404 on `/api/v1/agent/tasks`.

- [ ] **Step 3: Implement `apps/api/src/routes/tasks.ts` and register in `apps/api/src/app.ts`**

1. Create `apps/api/src/routes/tasks.ts`:
   - Prefix: `/api/v1/agent/tasks`.
   - Protect with `isAuth(true)`.
   - `GET /`: parse `query.page`, `query.limit`, `query.status`, `query.type`. Call `listTasks(...)`. Return `{ tasks, pagination }`.
   - `GET /:id`: validate numeric ID. Call `getTaskById(id)`. Return `{ task }` or 404.
   - `POST /:id/retry`:
     - Fetch task.
     - If `status !== TaskStatus.FAILED && status !== TaskStatus.DEAD`: return 400 with `{ error: { code: 'INVALID_TASK_STATE', message: 'Only failed or dead tasks can be retried' } }`.
     - Call `resetTaskForRetry(id)`.
     - Look up stream for task type via `getStreamForTaskType(task.type)`.
     - Call `publishTask(stream, { taskId: String(task.id), type: task.type })`.
     - Return `{ task: resetTask, status: 're-queued' }`.
2. Register `taskRoutes` in `apps/api/src/app.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/tasks-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat(api): implement task query, detail, and retry endpoints"
```

---

### Task 8: End-to-End Worker System Hardening Verification Test

**Files:**
- Create: `tests/e2e-worker-hardening.test.ts`

**Interfaces:**
- Exercises entire hardened background processing lifecycle end-to-end:
  - 1. Transient error → 2 retries with exponential backoff → 3rd attempt succeeds (`completed`).
  - 2. Permanent error → reaches `max_attempts` → marked `dead` + ACKed.
  - 3. Abandoned message recovery via `recoverPendingTasks` after idle timeout.
  - 4. Manual retry via API resets dead task and completes on next run.

- [ ] **Step 1: Write the end-to-end integration test**

```ts
// tests/e2e-worker-hardening.test.ts
import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  getTaskById,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import {
  createRedisClient,
  createConsumerGroupIfNotExists,
  publishTask,
  runTask,
  pollDueRetries,
  clearRetries,
  STREAMS,
} from '@client-agent/queue';
import { app } from '../apps/api/src/app';
import { createSession } from '../apps/api/src/auth/session';

describe('Phase 2 Worker System Hardening End-to-End', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_e2e_hardened_${Date.now()}`;
  const testGroup = 'e2e_hardened_group';
  const createdTaskIds: number[] = [];
  let ownerId: number;
  let cookieHeader: string;

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);
  });

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
    await clearRetries(redis);
    await redis.del(testStream);
    redis.disconnect();
  });

  it('executes transient failure with exponential backoff and succeeds on 3rd attempt', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { flaky: true },
    });
    createdTaskIds.push(task.id);

    let attemptCount = 0;
    const flakyHandler = async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error(`Flaky failure #${attemptCount}`);
      }
      return { success: true, resolvedAtAttempt: attemptCount };
    };

    // 1st Attempt: Fails
    const msg1 = await publishTask(testStream, { taskId: String(task.id) });
    const run1 = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: msg1, data: { taskId: String(task.id) } },
      retryDelays: [30, 60],
      handler: flakyHandler,
    });
    expect(run1.status).toBe('retried');
    let dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.FAILED);
    expect(dbTask!.attempts).toBe(1);

    // Wait for 1st retry delay
    await Bun.sleep(40);
    const publishedRetries1 = await pollDueRetries(redis);
    expect(publishedRetries1).toBe(1);

    // 2nd Attempt: Fails
    const entries2 = await redis.xrange(testStream, '-', '+');
    const msg2 = entries2[entries2.length - 1]![0];
    const run2 = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: msg2, data: { taskId: String(task.id) } },
      retryDelays: [30, 60],
      handler: flakyHandler,
    });
    expect(run2.status).toBe('retried');
    dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.FAILED);
    expect(dbTask!.attempts).toBe(2);

    // Wait for 2nd retry delay
    await Bun.sleep(70);
    const publishedRetries2 = await pollDueRetries(redis);
    expect(publishedRetries2).toBe(1);

    // 3rd Attempt: Succeeds
    const entries3 = await redis.xrange(testStream, '-', '+');
    const msg3 = entries3[entries3.length - 1]![0];
    const run3 = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: msg3, data: { taskId: String(task.id) } },
      retryDelays: [30, 60],
      handler: flakyHandler,
    });
    expect(run3.status).toBe('completed');
    dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.COMPLETED);
    expect(dbTask!.attempts).toBe(3);
    expect(dbTask!.output).toEqual({ success: true, resolvedAtAttempt: 3 });
  });

  it('transitions permanent failures to dead-letter, then recovers via manual API retry', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.NOTIFY_DISCORD,
      input: { doomed: true },
    });
    createdTaskIds.push(task.id);

    // Set attempts to 4 of 5
    await db.update(agentTasks).set({ attempts: 4, maxAttempts: 5 }).where(eq(agentTasks.id, task.id));

    const msg = await publishTask(testStream, { taskId: String(task.id) });
    const run = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: msg, data: { taskId: String(task.id) } },
      handler: async () => {
        throw new Error('Unrecoverable error');
      },
    });

    expect(run.status).toBe('dead');
    let dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.DEAD);
    expect(dbTask!.attempts).toBe(5);

    // Now trigger manual retry via API
    const retryRes = await app.handle(
      new Request(`http://localhost/api/v1/agent/tasks/${task.id}/retry`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(retryRes.status).toBe(200);

    dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.QUEUED);
    expect(dbTask!.attempts).toBe(0);
    expect(dbTask!.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/e2e-worker-hardening.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: ALL PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add comprehensive end-to-end integration tests for phase 2 worker hardening"
```
