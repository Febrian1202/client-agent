import { asc } from 'drizzle-orm';
import { db } from '../client';
import { users } from '../schema';

export async function getOwnerUserId(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1);
  if (!rows[0]) {
    throw new Error('No user row found - run bun run --filter=@client-agent/db seed');
  }
  return rows[0].id;
}
