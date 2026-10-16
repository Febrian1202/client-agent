import { and, desc, eq, sql } from 'drizzle-orm';
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

export async function markTaskRunningWithAttempt(id: number): Promise<AgentTaskRow> {
  const rows = await db
    .update(agentTasks)
    .set({
      status: TaskStatus.RUNNING,
      startedAt: sql`now()`,
      attempts: sql`${agentTasks.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(agentTasks.id, id))
    .returning();
  if (!rows[0]) {
    throw new Error(`Task ${id} not found`);
  }
  return rows[0];
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

export async function markTaskDead(id: number, error: string): Promise<AgentTaskRow> {
  const rows = await db
    .update(agentTasks)
    .set({
      status: TaskStatus.DEAD,
      error,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(agentTasks.id, id))
    .returning();
  if (!rows[0]) {
    throw new Error(`Task ${id} not found`);
  }
  return rows[0];
}

export async function resetTaskForRetry(id: number): Promise<AgentTaskRow | null> {
  const rows = await db
    .update(agentTasks)
    .set({
      status: TaskStatus.QUEUED,
      attempts: 0,
      error: null,
      startedAt: null,
      completedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(agentTasks.id, id))
    .returning();
  return rows[0] ?? null;
}

export interface ListTasksOptions {
  page?: number;
  limit?: number;
  status?: TaskStatus;
  type?: TaskType;
}

export interface ListTasksResult {
  tasks: AgentTaskRow[];
  total: number;
  page: number;
  limit: number;
}

export async function listTasks(options: ListTasksOptions = {}): Promise<ListTasksResult> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, options.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (options.status) {
    conditions.push(eq(agentTasks.status, options.status));
  }
  if (options.type) {
    conditions.push(eq(agentTasks.type, options.type));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTasks);
  const countRows = whereClause ? await countQuery.where(whereClause) : await countQuery;
  const total = Number(countRows[0]?.count ?? 0);

  const tasksQuery = db
    .select()
    .from(agentTasks);
  const tasks = whereClause
    ? await tasksQuery.where(whereClause).orderBy(desc(agentTasks.createdAt)).limit(limit).offset(offset)
    : await tasksQuery.orderBy(desc(agentTasks.createdAt)).limit(limit).offset(offset);

  return {
    tasks,
    total,
    page,
    limit,
  };
}
