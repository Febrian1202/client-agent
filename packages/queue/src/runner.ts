import type Redis from 'ioredis';
import type { ParsedTask } from './consumer';
import {
  getTaskById,
  markTaskRunningWithAttempt,
  markTaskCompleted,
  markTaskFailed,
  markTaskDead,
} from '@client-agent/db';
import { TaskStatus } from '@client-agent/domain';
import { calculateBackoffDelay, scheduleRetry } from './retry';

export type TaskHandler<TOutput = unknown> = (task: ParsedTask) => Promise<TOutput>;

export interface RunTaskOptions {
  redis: Redis;
  stream: string;
  group: string;
  task: ParsedTask;
  handler: TaskHandler;
  retryDelays?: number[];
  onDeadLetter?: (task: ParsedTask, error: string) => Promise<void> | void;
}

export interface TaskExecutionResult {
  status: 'completed' | 'retried' | 'dead' | 'skipped';
  output?: unknown;
  attempts?: number;
  delayMs?: number;
  error?: string;
  reason?: 'invalid_payload' | 'not_found' | 'already_completed' | 'already_dead';
}

export async function runTask(options: RunTaskOptions): Promise<TaskExecutionResult> {
  const { redis, stream, group, task, handler, retryDelays, onDeadLetter } = options;

  const rawTaskId = task?.data?.taskId;
  if (!task || !task.id || !task.data || !rawTaskId) {
    console.error(`[queue:runner] Invalid task payload or missing taskId for message ${task?.id ?? 'unknown'}`);
    if (task?.id) {
      await redis.xack(stream, group, task.id);
    }
    return { status: 'skipped', reason: 'invalid_payload' };
  }

  const taskId = Number(rawTaskId);
  if (Number.isNaN(taskId) || !Number.isInteger(taskId) || taskId <= 0) {
    console.error(`[queue:runner] Invalid taskId '${rawTaskId}' for message ${task.id}`);
    await redis.xack(stream, group, task.id);
    return { status: 'skipped', reason: 'invalid_payload' };
  }

  const taskRow = await getTaskById(taskId);
  if (!taskRow) {
    console.warn(`[queue:runner] Phantom task: taskId ${taskId} not found in database for message ${task.id}`);
    await redis.xack(stream, group, task.id);
    return { status: 'skipped', reason: 'not_found' };
  }

  if (taskRow.status === TaskStatus.COMPLETED) {
    await redis.xack(stream, group, task.id);
    return { status: 'skipped', reason: 'already_completed' };
  }

  if (taskRow.status === TaskStatus.DEAD) {
    await redis.xack(stream, group, task.id);
    return { status: 'skipped', reason: 'already_dead' };
  }

  const runningTask = await markTaskRunningWithAttempt(taskId);

  try {
    const output = await handler(task);
    const taskOutput = output && typeof output === 'object' ? (output as Record<string, unknown>) : {};
    await markTaskCompleted(taskId, taskOutput);
    await redis.xack(stream, group, task.id);
    return { status: 'completed', output };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (runningTask.attempts < runningTask.maxAttempts) {
      await markTaskFailed(taskId, errorMsg);
      const delay = calculateBackoffDelay(runningTask.attempts, retryDelays);
      await scheduleRetry(redis, stream, task.data, delay);
      await redis.xack(stream, group, task.id);
      return { status: 'retried', attempts: runningTask.attempts, delayMs: delay };
    } else {
      await markTaskDead(taskId, errorMsg);
      await redis.xack(stream, group, task.id);
      if (onDeadLetter) {
        try {
          await onDeadLetter(task, errorMsg);
        } catch (deadLetterErr) {
          console.error('[queue:runner] Error in onDeadLetter callback:', deadLetterErr);
        }
      }
      return { status: 'dead', attempts: runningTask.attempts, error: errorMsg };
    }
  }
}
