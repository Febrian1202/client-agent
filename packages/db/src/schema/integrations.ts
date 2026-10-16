import { bigint, bigserial, jsonb, pgTable, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const integrations = pgTable(
  'integrations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    provider: varchar('provider', { length: 50 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('disconnected'),
    credentialsEncrypted: text('credentials_encrypted'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('integrations_user_provider').on(t.userId, t.provider)],
);

export type IntegrationRow = typeof integrations.$inferSelect;
export type NewIntegrationRow = typeof integrations.$inferInsert;
