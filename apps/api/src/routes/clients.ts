import { Elysia, t } from 'elysia';
import {
  getClientById,
  listClients,
  insertClientMemory,
  getClientMemoryById,
  listClientMemories,
  updateClientMemory,
  deleteClientMemory,
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
    )
    .get(
      '/:id/memories',
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

        const memories = await listClientMemories(clientId);
        const grouped = {
          facts: memories.filter((m) => m.type === 'fact'),
          preferences: memories.filter((m) => m.type === 'preference'),
          inferences: memories.filter((m) => m.type === 'inference'),
        };

        return {
          memories,
          grouped,
        };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    )
    .post(
      '/:id/memories',
      async ({ params, body, set }) => {
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

        const content = body.content ? body.content.trim() : '';
        if (!content) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_CONTENT',
              message: 'Memory content cannot be empty',
            },
          };
        }

        const validTypes = ['fact', 'preference', 'inference'];
        const type = body.type.toLowerCase();
        if (!validTypes.includes(type)) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_TYPE',
              message: `Memory type must be one of: ${validTypes.join(', ')}`,
            },
          };
        }

        const memory = await insertClientMemory({
          clientId,
          type,
          category: body.category.toLowerCase(),
          content,
          source: body.source,
          confidence: body.confidence,
        });

        set.status = 201;
        return { memory };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
        body: t.Object({
          type: t.String(),
          category: t.String(),
          content: t.String(),
          source: t.Optional(t.String()),
          confidence: t.Optional(t.String()),
        }),
      }
    )
    .patch(
      '/:id/memories/:memoryId',
      async ({ params, body, set }) => {
        const clientId = Number(params.id);
        const memoryId = Number(params.memoryId);
        if (Number.isNaN(clientId) || clientId <= 0 || Number.isNaN(memoryId) || memoryId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_ID',
              message: 'Client and Memory IDs must be positive integers',
            },
          };
        }

        const existing = await getClientMemoryById(memoryId);
        if (!existing || existing.clientId !== clientId) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found for this client',
            },
          };
        }

        const content = body.content !== undefined ? body.content.trim() : undefined;
        if (content !== undefined && !content) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_CONTENT',
              message: 'Memory content cannot be empty',
            },
          };
        }

        const validTypes = ['fact', 'preference', 'inference'];
        const type = body.type ? body.type.toLowerCase() : undefined;
        if (type && !validTypes.includes(type)) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_TYPE',
              message: `Memory type must be one of: ${validTypes.join(', ')}`,
            },
          };
        }

        const updated = await updateClientMemory(memoryId, {
          content,
          type,
          category: body.category ? body.category.toLowerCase() : undefined,
        });
        return { memory: updated };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
          memoryId: t.Numeric(),
        }),
        body: t.Object({
          content: t.Optional(t.String()),
          type: t.Optional(t.String()),
          category: t.Optional(t.String()),
        }),
      }
    )
    .delete(
      '/:id/memories/:memoryId',
      async ({ params, set }) => {
        const clientId = Number(params.id);
        const memoryId = Number(params.memoryId);
        if (Number.isNaN(clientId) || clientId <= 0 || Number.isNaN(memoryId) || memoryId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_ID',
              message: 'Client and Memory IDs must be positive integers',
            },
          };
        }

        const existing = await getClientMemoryById(memoryId);
        if (!existing || existing.clientId !== clientId) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found for this client',
            },
          };
        }

        await deleteClientMemory(memoryId);
        return { success: true };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
          memoryId: t.Numeric(),
        }),
      }
    );
}

export const clientRoutes = createClientRoutes();
