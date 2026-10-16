# Phase 2 — Worker System Hardening: Step-by-Step Implementation Guide

> **Goal:** Transform the raw Redis Streams consumer into a production-grade, resilient worker engine featuring a strict task state machine, exponential backoff retries, dead-letter management, idempotency enforcement, graceful shutdown, and task observability APIs.
> **Prerequisites:** Phase 1 completed.

---

## Architecture Context for This Phase

In Phase 1, workers processed tasks simply by reading from streams. In Phase 2, we guarantee that:
1. No tasks are lost if a worker process crashes mid-execution (Redis PEL — Pending Entries List).
2. Transient failures retry with bounded backoff up to `max_attempts`.
3. Permanent failures move safely to a `dead` state without blocking other jobs.
4. Duplicate submissions with identical `idempotency_key` do not trigger duplicate executions.
5. Graceful shutdown gives running jobs a chance to finish cleanly before exiting.

---

## Task State Machine

```text
       ┌───────────┐
       │  QUEUED   │ ◄────────────────────────┐
       └─────┬─────┘                          │
             │ Worker picks up task           │
             ▼                                │ Retry (attempts < max_attempts)
       ┌───────────┐                          │ with backoff delay
       │  RUNNING  │                          │
       └─────┬─────┘                          │
             │                                │
     ┌───────┴──────────────┐                 │
     │                      │                 │
     ▼                      ▼                 │
┌───────────┐         ┌───────────┐           │
│ COMPLETED │         │  FAILED   ├───────────┘
└───────────┘         └─────┬─────┘
                            │ attempts >= max_attempts
                            ▼
                      ┌───────────┐
                      │   DEAD    │ (Dead-Letter)
                      └───────────┘
```

---

## Atomic Task Breakdown

### Task 2.1: Robust Task Execution Wrapper in `packages/queue`
- [ ] Implement Task Runner abstraction (`src/runner.ts`):
  - Wraps execution of any task handler:
    1. Update task record in PostgreSQL: `status = 'running'`, `started_at = now()`, `attempts = attempts + 1`.
    2. Try executing the handler function.
    3. On success:
       - Update task in PostgreSQL: `status = 'completed'`, `completed_at = now()`, `output = result`.
       - Acknowledge message in Redis Stream (`XACK stream group id`).
    4. On error:
       - Update task in PostgreSQL: `error = err.message`.
       - If `attempts < max_attempts`:
         - Set `status = 'failed'`.
         - Schedule retry (publish to retry delay sorted set or re-queue with exponential backoff: 2s, 10s, 30s, 60s).
       - If `attempts >= max_attempts`:
         - Set `status = 'dead'`, `completed_at = now()`.
         - Acknowledge in Redis Stream (`XACK`) to prevent infinite poison pill loops.
         - Send alert / log critical dead-letter event.

---

### Task 2.2: Idempotency Key Guard
- [ ] In `packages/queue/src/idempotency.ts`:
  - Provide helper `checkAndClaimIdempotency(db, idempotencyKey: string): Promise<boolean>`
  - If a task with `idempotency_key` exists and is `completed` or `running`, reject or return existing task ID immediately.
  - Integrate this check in API task submission and worker pre-execution.

---

### Task 2.3: Pending Entries Recovery (Crash Resilience)
- [ ] In `packages/queue/src/recovery.ts`:
  - Implement consumer startup recovery routine using Redis `XAUTOCLAIM` or `XPENDING`:
  - When a worker boots, check for messages in the consumer group that have been pending for longer than timeout (e.g. 5 minutes) without an `XACK`.
  - Claim orphaned messages from dead workers and re-process them.

---

### Task 2.4: Graceful Shutdown Implementation
- [ ] In `apps/worker/src/index.ts`:
  - Track active in-flight tasks (`activeJobsCounter: number`).
  - Listen for `SIGTERM` and `SIGINT`:
    1. Stop accepting new messages from Redis Streams (`isShuttingDown = true`).
    2. Wait up to 15 seconds for active in-flight tasks to complete.
    3. Close database and Redis connections cleanly.
    4. Exit process with code 0.

---

### Task 2.5: Task Observability APIs in `apps/api`
- [ ] In `apps/api/src/routes/tasks.ts`:
  - `GET /api/v1/agent/tasks`:
    - List tasks with pagination (`?page=1&limit=20`).
    - Filter by `?status=queued|running|completed|failed|dead` and `?type=...`.
  - `GET /api/v1/agent/tasks/:id`:
    - Return detailed task record including attempts, errors, timestamps, input, output.
  - `POST /api/v1/agent/tasks/:id/retry`:
    - Allow manual retry of a `dead` or `failed` task by resetting `attempts = 0` and re-queuing.
- [ ] Register task routes in `apps/api/src/index.ts`.

---

## Verification & Testing Steps

1. **Failure & Retry Test:**
   - Create a dummy test worker handler that deliberately throws an error on the first 2 attempts and succeeds on the 3rd attempt.
   - Enqueue the task.
   - Inspect database: confirm `attempts` increments: 1 (`failed`) → 2 (`failed`) → 3 (`completed`).
   - Confirm final status is `completed`.

2. **Dead-Letter Test:**
   - Create a dummy task handler that always throws an error.
   - Enqueue with `max_attempts = 3`.
   - Verify task state transitions: `running` → `failed` → `running` → `failed` → `running` → `dead`.
   - Confirm Redis message is acknowledged and does not poison the stream.

3. **Crash Recovery Test:**
   - Start worker, push a task that sleeps for 10 seconds.
   - Force kill the worker process (`kill -9 <pid>`) mid-execution.
   - Restart the worker.
   - Verify `XAUTOCLAIM` / recovery picks up the pending unacknowledged message and completes it.

4. **API Observability Test:**
   ```bash
   curl -i http://localhost:3001/api/v1/agent/tasks?status=completed
   ```
   Verify paginated list of completed tasks returns JSON format correctly.

---

## Done When Checklist
- [ ] Tasks cleanly transition through the full lifecycle: `queued` → `running` → `completed` | `failed` → `dead`.
- [ ] Exponential backoff delay prevents hammering resources during transient network glitches.
- [ ] Dead tasks are safely acknowledged in Redis and flagged in PostgreSQL with full error context.
- [ ] Crash recovery routinely re-claims abandoned pending messages.
- [ ] Worker responds to `SIGTERM` by finishing active jobs and exiting cleanly.
- [ ] Task query endpoints (`GET /agent/tasks`) provide full visibility into background jobs.
