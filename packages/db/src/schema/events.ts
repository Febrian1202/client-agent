import { jsonb, bigserial, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EventStatus, type VGenEventPayload, type VGenEventType } from '@client-agent/domain';

export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  source: varchar('source', { length: 50 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).$type<VGenEventType>().notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull().unique(),
  payload: jsonb('payload').$type<VGenEventPayload>().notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 50 }).$type<EventStatus>().notNull().default(EventStatus.RECEIVED),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
