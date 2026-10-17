import { bigint, bigserial, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { clients } from './clients';

export const conversations = pgTable(
  'conversations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    clientId: bigint('client_id', { mode: 'number' }).notNull().references(() => clients.id),
    platform: varchar('platform', { length: 50 }).notNull().default('vgen'),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    externalUrl: varchar('external_url', { length: 500 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('conversations_platform_external_id').on(t.platform, t.externalId)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
