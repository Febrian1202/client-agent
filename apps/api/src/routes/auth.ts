import { Elysia, t } from 'elysia';
import { config } from '@client-agent/config';
import { verifyPassword } from '@client-agent/shared';
import { db, users, eq } from '@client-agent/db';
import { createSession, deleteSession } from '../auth/session';
import { authPlugin } from '../auth/plugin';

export const authRoutes = new Elysia({ prefix: '/api/v1/auth' })
  .use(authPlugin)
  .post(
    '/login',
    async ({ body, cookie: { session }, set }) => {
      const { username, password } = body;

      // Timing attack mitigation: verify against hash even if username does not match
      if (username !== config.AUTH_USERNAME) {
        await verifyPassword(password, config.AUTH_PASSWORD_HASH);
        set.status = 401;
        return {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
          },
        };
      }

      const isPasswordValid = await verifyPassword(password, config.AUTH_PASSWORD_HASH);
      if (!isPasswordValid) {
        set.status = 401;
        return {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
          },
        };
      }

      // Fetch or create user record in PostgreSQL
      let userList = await db.select().from(users).where(eq(users.name, username));
      let user = userList[0];
      if (!user) {
        const inserted = await db
          .insert(users)
          .values({
            name: username,
            email: `${username}@localhost`,
          })
          .returning();
        user = inserted[0];
      }

      // Create session in Redis
      const sessionId = await createSession(user!.id, username);

      // Set HTTP-Only Cookie
      session?.set({
        value: sessionId,
        httpOnly: true,
        sameSite: 'strict',
        secure: config.NODE_ENV === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });

      return {
        user: {
          id: user!.id,
          name: user!.name,
          email: user!.email,
        },
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
      }),
    }
  )
  .post('/logout', async ({ cookie: { session } }) => {
    const sessionId = typeof session?.value === 'string' ? session.value : '';
    if (sessionId) {
      await deleteSession(sessionId);
      session?.remove();
    }
    return { ok: true };
  })
  .get(
    '/me',
    ({ currentUser }) => {
      return {
        user: {
          id: currentUser!.id,
          name: currentUser!.name,
          email: currentUser!.email,
        },
      };
    },
    {
      isAuth: true,
    }
  )
  .get(
    '/protected-test',
    ({ currentUser }) => {
      return {
        message: 'Protected resource accessed',
        user: {
          id: currentUser!.id,
          name: currentUser!.name,
        },
      };
    },
    {
      isAuth: true,
    }
  );
