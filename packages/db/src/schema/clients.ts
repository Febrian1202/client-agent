import { bigint, bigserial, jsonb, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const clients = pgTable(
  'clients',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    platform: varchar('platform', { length: 50 }).notNull().default('vgen'),
    externalId: varchar('external_id', { length: 255 }),
    username: varchar('username', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    profileUrl: varchar('profile_url', { length: 1024 }),
    avatarUrl: varchar('avatar_url', { length: 1024 }),
    metadata: jsonb('metadata').notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('clients_user_platform_username').on(t.userId, t.platform, t.username)],
);

export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
