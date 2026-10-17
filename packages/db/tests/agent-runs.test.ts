import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  db,
  getOwnerUserId,
  createTask,
  agentTasks,
  agentRuns,
  insertAgentRun,
  getAgentRunsByTaskId,
} from '../src/index';
import { TaskType } from '@client-agent/domain';

describe('agent_runs table and queries', () => {
  let taskId: number;
  const suffix = Date.now();
  const taskKey = `agent-runs-test:${suffix}`;

  beforeAll(async () => {
    const userId = await getOwnerUserId();
    const task = await createTask({
      userId,
      type: TaskType.READ_VGEN_CONVERSATION,
      input: { clientUsername: 'test_client' },
      idempotencyKey: taskKey,
    });
    taskId = task.id;
  });

  afterAll(async () => {
    await db.delete(agentRuns).where(eq(agentRuns.taskId, taskId));
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
  });

  it('inserts an agent run and retrieves it by taskId', async () => {
    const run = await insertAgentRun({
      taskId,
      provider: '9router',
      model: 'custom-combo-v1',
      systemVersion: 'v1.0',
      input: { prompt: 'Summarize conversation', temperature: 0.7 },
      output: { content: 'Client requested layer separation.', finishReason: 'stop' },
      promptTokens: 150,
      completionTokens: 40,
      totalTokens: 190,
      durationMs: 850,
      status: 'success',
    });

    expect(run.id).toBeGreaterThan(0);
    expect(run.taskId).toBe(taskId);
    expect(run.provider).toBe('9router');
    expect(run.model).toBe('custom-combo-v1');
    expect(run.totalTokens).toBe(190);
    expect(run.durationMs).toBe(850);
    expect(run.status).toBe('success');
    expect(run.errorMessage).toBeNull();
    expect(run.createdAt).toBeInstanceOf(Date);

    const runs = await getAgentRunsByTaskId(taskId);
    expect(runs).toBeArray();
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe(run.id);
  });

  it('supports error runs with errorMessage', async () => {
    const errorRun = await insertAgentRun({
      taskId,
      provider: '9router',
      model: 'custom-combo-v1',
      systemVersion: 'v1.0',
      input: { prompt: 'Reply to client' },
      output: {},
      durationMs: 300,
      status: 'error',
      errorMessage: 'Rate limit exceeded (429)',
    });

    expect(errorRun.status).toBe('error');
    expect(errorRun.errorMessage).toBe('Rate limit exceeded (429)');
    expect(errorRun.promptTokens).toBeNull();

    const runs = await getAgentRunsByTaskId(taskId);
    expect(runs.length).toBe(2);
  });
});
