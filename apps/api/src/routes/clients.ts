import { Elysia, t } from 'elysia';
import {
  getClientById,
  listClients,
} from '@client-agent/db';
import { authPlugin } from '../auth/plugin';

export function createClientRoutes() {
  return new Elysia({ prefix: '/api/v1/clients' })
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

        const clients = await listClients({
          search: query.search,
          platform: query.platform,
          userId,
          limit,
          offset,
        });

        return {
          clients,
          data: clients,
        };
      },
      {
        isAuth: true,
        query: t.Object({
          search: t.Optional(t.String()),
          platform: t.Optional(t.String()),
          userId: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )
    .get(
      '/:id',
      async ({ params, set }) => {
        const clientId = Number(params.id);
        if (Number.isNaN(clientId) || clientId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_CLIENT_ID',
              message: 'Client ID must be a positive integer',
            },
          };
        }

        const client = await getClientById(clientId);
        if (!client) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Client not found',
            },
          };
        }

        return { client };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    );
}

export const clientRoutes = createClientRoutes();
