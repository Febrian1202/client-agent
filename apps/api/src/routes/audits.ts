import { Elysia, t } from 'elysia';
import { listAuditLogs } from '@client-agent/db';
import { authPlugin } from '../auth/plugin';

export function createAuditRoutes() {
  return new Elysia({ prefix: '/api/v1/audit-log' })
    .use(authPlugin)
    .get(
      '/',
      async ({ query }) => {
        const rawLimit = query.limit ? parseInt(query.limit, 10) : undefined;
        const rawOffset = query.offset ? parseInt(query.offset, 10) : undefined;
        const rawUserId = query.userId ? parseInt(query.userId, 10) : undefined;

        const limit = rawLimit !== undefined && !Number.isNaN(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : undefined;
        const offset = rawOffset !== undefined && !Number.isNaN(rawOffset) ? Math.max(0, rawOffset) : undefined;
        const userId = rawUserId !== undefined && !Number.isNaN(rawUserId) ? rawUserId : undefined;

        const logs = await listAuditLogs({
          actorType: query.actorType,
          targetType: query.targetType,
          userId,
          limit,
          offset,
        });

        return {
          auditLogs: logs,
          data: logs,
        };
      },
      {
        isAuth: true,
        query: t.Object({
          actorType: t.Optional(t.String()),
          targetType: t.Optional(t.String()),
          userId: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    );
}

export const auditRoutes = createAuditRoutes();
