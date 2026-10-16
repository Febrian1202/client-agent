import { Elysia, t } from 'elysia';
import { config } from '@client-agent/config';
import { verifyPassword } from '@client-agent/shared';
import { db, users, eq } from '@client-agent/db';
import { createSession, deleteSession, getSession } from '../auth/session';

export const authRoutes = new Elysia({ prefix: '/api/v1/auth' })
  .post(
    '/login',
    async ({ body, cookie: { session }, set }) => {
      const { username, password } = body;

      // 1. Verify single-user credentials
      if (username !== config.AUTH_USERNAME) {
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

      // 2. Fetch or create user record in PostgreSQL
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

      // 3. Create session in Redis
      const sessionId = await createSession(user!.id, username);

      // 4. Set HTTP-Only Cookie
      session.set({
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
        username: t.String(),
        password: t.String(),
      }),
    }
  )
  .post('/logout', async ({ cookie: { session } }) => {
    if (session.value) {
      await deleteSession(session.value);
      session.remove();
    }
    return { ok: true };
  })
  .get('/me', async ({ cookie: { session }, set }) => {
    if (!session.value) {
      set.status = 401;
      return {
        error: {
          code: 'UNAUTHORIZED',
          message: 'No active session',
        },
      };
    }

    const sessionData = await getSession(session.value);
    if (!sessionData) {
      session.remove();
      set.status = 401;
      return {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session expired or invalid',
        },
      };
    }

    const userList = await db.select().from(users).where(eq(users.id, sessionData.userId));
    const user = userList[0];

    if (!user) {
      set.status = 401;
      return {
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User no longer exists',
        },
      };
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  });
