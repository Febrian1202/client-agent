import { bigint, bigserial, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { clients } from './clients';

export const clientMemories = pgTable('client_memories', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  clientId: bigint('client_id', { mode: 'number' })
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  category: varchar('category', { length: 64 }).notNull(),
  content: text('content').notNull(),
  source: varchar('source', { length: 64 }).notNull().default('user_note'),
  confidence: varchar('confidence', { length: 32 }).notNull().default('high'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ClientMemoryRow = typeof clientMemories.$inferSelect;
export type NewClientMemoryRow = typeof clientMemories.$inferInsert;
