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

  it('enforces uniqueness on idempotencyKey', async () => {
    ownerId = await getOwnerUserId();
    const key = `test-idempotency-${Date.now()}`;
    const task1 = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { test: 1 },
      idempotencyKey: key,
    });
    testIds.push(task1.id);

    await expect(
      createTask({
        userId: ownerId,
        type: TaskType.PROCESS_GMAIL_EVENT,
        input: { test: 2 },
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('allows multiple tasks with null idempotencyKey', async () => {
    ownerId = await getOwnerUserId();
    const task1 = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { test: 'null-key-1' },
    });
    testIds.push(task1.id);

    const task2 = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { test: 'null-key-2' },
    });
    testIds.push(task2.id);

    expect(task1.id).toBeDefined();
    expect(task2.id).toBeDefined();
  });
});
