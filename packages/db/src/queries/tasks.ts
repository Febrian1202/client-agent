import { eq, sql } from 'drizzle-orm';
import type { TaskType } from '@client-agent/domain';
import { TaskStatus } from '@client-agent/domain';
import { db } from '../client';
import { agentTasks, type AgentTaskRow } from '../schema';

export interface CreateTaskInput {
  userId: number;
  eventId?: number | null;
  type: TaskType;
  input: Record<string, unknown>;
  idempotencyKey?: string;
}

export async function createTask(input: CreateTaskInput): Promise<AgentTaskRow> {
  const rows = await db
    .insert(agentTasks)
    .values({
      userId: input.userId,
      eventId: input.eventId ?? null,
      type: input.type,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();
  return rows[0]!;
}

export async function getTaskById(id: number): Promise<AgentTaskRow | null> {
  const rows = await db.select().from(agentTasks).where(eq(agentTasks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findTaskByIdempotencyKey(key: string): Promise<AgentTaskRow | null> {
  const rows = await db.select().from(agentTasks).where(eq(agentTasks.idempotencyKey, key)).limit(1);
  return rows[0] ?? null;
}

export async function markTaskRunning(id: number): Promise<void> {
  await db
    .update(agentTasks)
    .set({ status: TaskStatus.RUNNING, startedAt: sql`now()`, attempts: sql`${agentTasks.attempts} + 1`, updatedAt: sql`now()` })
    .where(eq(agentTasks.id, id));
}

export async function markTaskCompleted(id: number, output: Record<string, unknown>): Promise<void> {
  await db
    .update(agentTasks)
    .set({ status: TaskStatus.COMPLETED, output, completedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(agentTasks.id, id));
}

export async function markTaskFailed(id: number, error: string): Promise<void> {
  await db
    .update(agentTasks)
    .set({ status: TaskStatus.FAILED, error, updatedAt: sql`now()` })
    .where(eq(agentTasks.id, id));
}
