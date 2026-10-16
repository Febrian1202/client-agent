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
