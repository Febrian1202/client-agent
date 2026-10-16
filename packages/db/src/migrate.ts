import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, client } from './client';
import { resolve } from 'path';

export async function runMigrations() {
  const migrationsFolder = resolve(import.meta.dir, '../drizzle');
  console.log(`Running database migrations from: ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations completed successfully.');
}

if (import.meta.main) {
  try {
    await runMigrations();
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    await client.end();
    process.exit(1);
  }
}
