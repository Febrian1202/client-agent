import { bigserial, bigint, text, varchar, timestamp, pgTable } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';
import { agentRuns } from './agent_runs';
import { users } from './users';

export const drafts = pgTable('drafts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  conversationId: bigint('conversation_id', { mode: 'number' })
    .notNull()
    .references(() => conversations.id),
  agentRunId: bigint('agent_run_id', { mode: 'number' })
    .references(() => agentRuns.id),
  content: text('content').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending_approval'),
  approvedBy: bigint('approved_by', { mode: 'number' })
    .references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type DraftRow = typeof drafts.$inferSelect;
export type InsertDraftRow = typeof drafts.$inferInsert;
