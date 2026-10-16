import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  agentTasks,
  getOwnerUserId,
  createTask,
  markTaskDead,
  markTaskFailed,
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

  it('GET /api/v1/agent/tasks caps limit at 100', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/agent/tasks?limit=500', {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.limit).toBe(100);
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

  it('GET /api/v1/agent/tasks/:id returns 404 for non-existent task', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/agent/tasks/99999999', {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/v1/agent/tasks/:id returns 400 for invalid id', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/agent/tasks/invalid-id', {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TASK_ID');
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
    expect(body.status).toBe('re-queued');
  });

  it('POST /api/v1/agent/tasks/:id/retry also resets failed task and re-queues', async () => {
    const task = await createTask({
      userId: ownerId,
      type: TaskType.NOTIFY_DISCORD,
      input: { retryFailed: true },
    });
    createdTaskIds.push(task.id);
    await markTaskFailed(task.id, 'Temporary network glitch');

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
    expect(body.status).toBe('re-queued');
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

  it('POST /api/v1/agent/tasks/:id/retry returns 404 for non-existent task', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/agent/tasks/99999999/retry', {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
