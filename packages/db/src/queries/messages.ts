import { db } from '../client';
import { messages } from '../schema';

export interface NewMessageInput {
  externalId: string;
  direction: 'inbound' | 'outbound';
  senderType: 'client' | 'creator' | 'agent';
  senderName: string;
  content: string;
  sentAt?: Date | null;
  metadata?: Record<string, unknown>;
}

const MAX_ROWS_PER_STATEMENT = 100;

export async function insertMessagesIfNew(conversationId: number, inputs: NewMessageInput[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < inputs.length; index += MAX_ROWS_PER_STATEMENT) {
    const chunk = inputs.slice(index, index + MAX_ROWS_PER_STATEMENT);
    const rows = await db
      .insert(messages)
      .values(
        chunk.map((message) => ({
          conversationId,
          externalId: message.externalId,
          direction: message.direction,
          senderType: message.senderType,
          senderName: message.senderName,
          content: message.content,
          sentAt: message.sentAt ?? null,
          metadata: message.metadata ?? {},
        })),
      )
      .onConflictDoNothing({ target: [messages.conversationId, messages.externalId] })
      .returning();
    inserted += rows.length;
  }
  return inserted;
}
