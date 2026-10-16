import { Elysia } from 'elysia';
import { getSession } from './session';
import { db, users, eq } from '@client-agent/db';

export const authPlugin = new Elysia({ name: 'auth-plugin' })
  .macro({
    isAuth(enabled: boolean) {
      if (!enabled) return {};
      return {
        async beforeHandle({ cookie: { session }, set }) {
          const sessionId = typeof session?.value === 'string' ? session.value : '';
          if (!sessionId) {
            set.status = 401;
            return {
              error: { code: 'UNAUTHORIZED', message: 'No active session' },
            };
          }

          const sessionData = await getSession(sessionId);
          if (!sessionData) {
            session?.remove();
            set.status = 401;
            return {
              error: { code: 'UNAUTHORIZED', message: 'Session expired or invalid' },
            };
          }

          const userList = await db.select().from(users).where(eq(users.id, sessionData.userId));
          if (!userList[0]) {
            set.status = 401;
            return {
              error: { code: 'USER_NOT_FOUND', message: 'User no longer exists' },
            };
          }
        },
        async resolve({ cookie: { session } }) {
          const sessionId = typeof session?.value === 'string' ? session.value : '';
          if (!sessionId) return { currentUser: null };

          const sessionData = await getSession(sessionId);
          if (!sessionData) return { currentUser: null };

          const userList = await db.select().from(users).where(eq(users.id, sessionData.userId));
          return { currentUser: userList[0] || null };
        },
      };
    },
  });
