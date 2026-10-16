import { bigint, bigserial, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { TaskStatus, type TaskType } from '@client-agent/domain';
import { users } from './users';
import { events } from './events';

export const agentTasks = pgTable(
  'agent_tasks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    eventId: bigint('event_id', { mode: 'number' }).references(() => events.id),
    type: varchar('type', { length: 100 }).$type<TaskType>().notNull(),
    status: varchar('status', { length: 50 }).$type<TaskStatus>().notNull().default(TaskStatus.QUEUED),
    input: jsonb('input').notNull().default({}),
    output: jsonb('output'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('agent_tasks_idempotency_key_idx').on(table.idempotencyKey),
  ],
);

export type AgentTaskRow = typeof agentTasks.$inferSelect;
export type NewAgentTaskRow = typeof agentTasks.$inferInsert;
