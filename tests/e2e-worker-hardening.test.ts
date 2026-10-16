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
  consumeNextTask,
  publishTask,
  runTask,
  pollDueRetries,
  clearRetries,
  recoverPendingTasks,
  STREAMS,
} from '@client-agent/queue';
import { app } from '../apps/api/src/app';
import { createSession } from '../apps/api/src/auth/session';

describe('Phase 2 Worker System Hardening End-to-End', () => {
  const redis = createRedisClient();
  const testStream = `${STREAMS.EVENTS}_e2e_hardened_${Date.now()}`;
  const recoveryStream = `${STREAMS.EVENTS}_e2e_recovery_${Date.now()}`;
  const testGroup = 'e2e_hardened_group';
  const createdTaskIds: number[] = [];
  let ownerId: number;
  let cookieHeader: string;

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;
    await createConsumerGroupIfNotExists(testStream, testGroup, redis);
    await createConsumerGroupIfNotExists(recoveryStream, testGroup, redis);
  });

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, id));
    }
    await clearRetries(redis);
    await redis.del(testStream);
    await redis.del(recoveryStream);
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

    // Verify task can now be processed to completion on its next run
    const nextMsg = await publishTask(testStream, { taskId: String(task.id) });
    const nextRun = await runTask({
      redis,
      stream: testStream,
      group: testGroup,
      task: { id: nextMsg, data: { taskId: String(task.id) } },
      handler: async () => ({ manuallyRetriedAndSucceeded: true }),
    });
    expect(nextRun.status).toBe('completed');
    dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.COMPLETED);
    expect(dbTask!.attempts).toBe(1);
    expect(dbTask!.output).toEqual({ manuallyRetriedAndSucceeded: true });
  });

  it('recovers abandoned in-flight tasks via recoverPendingTasks after worker idle timeout', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.PROCESS_GMAIL_EVENT,
      input: { crashResilience: true },
    });
    createdTaskIds.push(task.id);

    const crashedWorker = 'crashed_worker_pid_101';
    const recoveryWorker = 'recovery_worker_pid_202';

    // 1. Dead worker consumes a task from recoveryStream but crashes before ACK or completion
    const msgId = await publishTask(recoveryStream, { taskId: String(task.id) });
    const consumed = await consumeNextTask(redis, {
      stream: recoveryStream,
      group: testGroup,
      consumer: crashedWorker,
      blockMs: 1000,
    });
    expect(consumed).not.toBeNull();
    expect(consumed!.id).toBe(msgId);
    expect(consumed!.data.taskId).toBe(String(task.id));

    // 2. Recovery runs immediately before minIdleTimeMs (100ms) - should not claim yet
    const claimedEarly = await recoverPendingTasks({
      redis,
      stream: recoveryStream,
      group: testGroup,
      consumer: recoveryWorker,
      minIdleTimeMs: 100,
    });
    expect(claimedEarly.some((t) => t.id === msgId)).toBe(false);

    // Wait 120ms to exceed idle timeout threshold
    await Bun.sleep(120);

    // 3. Recovery worker claims the abandoned in-flight task
    const recovered = await recoverPendingTasks({
      redis,
      stream: recoveryStream,
      group: testGroup,
      consumer: recoveryWorker,
      minIdleTimeMs: 100,
    });
    const recoveredTask = recovered.find((t) => t.id === msgId);
    expect(recoveredTask).toBeDefined();
    expect(recoveredTask!.data.taskId).toBe(String(task.id));

    // 4. Recovered task runs and completes successfully
    const recoveredRun = await runTask({
      redis,
      stream: recoveryStream,
      group: testGroup,
      task: recoveredTask!,
      handler: async () => ({ recoveredAfterCrash: true }),
    });
    expect(recoveredRun.status).toBe('completed');

    const dbTask = await getTaskById(task.id);
    expect(dbTask!.status).toBe(TaskStatus.COMPLETED);
    expect(dbTask!.attempts).toBe(1);
    expect(dbTask!.output).toEqual({ recoveredAfterCrash: true });
  });
});
