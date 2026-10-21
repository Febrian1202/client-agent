import { bigint, bigserial, date, jsonb, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { CommissionStatus } from '@client-agent/domain';

export const commissions = pgTable('commissions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  clientId: bigint('client_id', { mode: 'number' })
    .notNull()
    .references(() => clients.id),
  externalId: varchar('external_id', { length: 255 }).unique(),
  serviceName: varchar('service_name', { length: 255 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  estimatedStart: date('estimated_start', { mode: 'string' }),
  guaranteedDelivery: date('guaranteed_delivery', { mode: 'string' }),
  status: varchar('status', { length: 50 }).$type<CommissionStatus | string>().notNull().default(CommissionStatus.REQUESTED),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type CommissionRow = typeof commissions.$inferSelect;
export type InsertCommissionRow = typeof commissions.$inferInsert;
export type NewCommissionRow = typeof commissions.$inferInsert;
