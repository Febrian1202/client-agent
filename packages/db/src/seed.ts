import { db, client } from './client';
import { users } from './schema/users';
import { config } from '@client-agent/config';

export async function seed() {
  const existingUsers = await db.select().from(users);
  if (existingUsers.length === 0) {
    console.log(`Seeding initial user '${config.AUTH_USERNAME}'...`);
    await db.insert(users).values({
      name: config.AUTH_USERNAME,
      email: `${config.AUTH_USERNAME}@localhost`,
    });
    console.log('Seeding completed.');
  } else {
    console.log('User table already seeded.');
  }
}

if (import.meta.main) {
  try {
    await seed();
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    await client.end();
    process.exit(1);
  }
}
