import { bigint, bigserial, jsonb, pgTable, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: bigint('conversation_id', { mode: 'number' }).notNull().references(() => conversations.id),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    direction: varchar('direction', { length: 20 }).notNull(),
    senderType: varchar('sender_type', { length: 20 }).notNull(),
    senderName: varchar('sender_name', { length: 255 }).notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('messages_conversation_external_id').on(t.conversationId, t.externalId)],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
