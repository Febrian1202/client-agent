import { bigserial, bigint, varchar, timestamp, pgTable } from 'drizzle-orm/pg-core';
import { drafts } from './drafts';
import { users } from './users';

export const approvals = pgTable('approvals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  draftId: bigint('draft_id', { mode: 'number' })
    .notNull()
    .references(() => drafts.id),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  action: varchar('action', { length: 50 }).notNull(), // 'approve' | 'reject'
  status: varchar('status', { length: 50 }).notNull().default('active'), // 'active' | 'revoked'
  contentHash: varchar('content_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ApprovalRow = typeof approvals.$inferSelect;
export type InsertApprovalRow = typeof approvals.$inferInsert;
