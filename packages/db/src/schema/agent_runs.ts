import { bigint, bigserial, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { agentTasks } from './agent_tasks';

export const agentRuns = pgTable('agent_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskId: bigint('task_id', { mode: 'number' }).references(() => agentTasks.id),
  provider: varchar('provider', { length: 100 }).notNull(),
  model: varchar('model', { length: 255 }).notNull(),
  systemVersion: varchar('system_version', { length: 50 }).notNull().default('v1.0'),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output').notNull().default({}),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  durationMs: integer('duration_ms').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('success'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
