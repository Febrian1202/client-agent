import { eq, sql } from 'drizzle-orm';
import type { VGenEventPayload, VGenEventType } from '@client-agent/domain';
import { EventStatus } from '@client-agent/domain';
import { db } from '../client';
import { events, type EventRow } from '../schema';

export interface InsertEventInput {
  source: string;
  provider: string;
  eventType: VGenEventType;
  externalId: string;
  payload: VGenEventPayload;
  receivedAt: Date;
}

export async function insertEventIfNew(input: InsertEventInput): Promise<EventRow | null> {
  const rows = await db
    .insert(events)
    .values({
      source: input.source,
      provider: input.provider,
      eventType: input.eventType,
      externalId: input.externalId,
      payload: input.payload,
      receivedAt: input.receivedAt,
    })
    .onConflictDoNothing({ target: events.externalId })
    .returning();
  return rows[0] ?? null;
}

export async function getEventById(id: number): Promise<EventRow | null> {
  const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markEventProcessed(id: number): Promise<void> {
  await db
    .update(events)
    .set({ status: EventStatus.PROCESSED, processedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(events.id, id));
}

export async function markEventFailed(id: number): Promise<void> {
  await db
    .update(events)
    .set({ status: EventStatus.FAILED, updatedAt: sql`now()` })
    .where(eq(events.id, id));
}
