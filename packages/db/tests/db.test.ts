import { describe, expect, it } from 'bun:test';
import { db, sql } from '../src/index';
import { users } from '../src/schema';

describe('Database Connection and Schema', () => {
  it('connects to PostgreSQL and executes raw query', async () => {
    const result = await db.execute(sql`SELECT 1 as val;`);
    expect(result).toBeDefined();
    expect(Number(result[0]?.val)).toBe(1);
  });

  it('queries users table without throwing', async () => {
    const allUsers = await db.select().from(users);
    expect(Array.isArray(allUsers)).toBeTrue();
  });
});
