import { Elysia, t } from 'elysia';
import {
  createTask,
  getConversationById,
  getConversationWithClient,
  listConversations,
  getMessagesByConversationId,
} from '@client-agent/db';
import { TaskType } from '@client-agent/domain';
import { STREAMS, publishTask } from '@client-agent/queue';
import { authPlugin } from '../auth/plugin';

export interface ConversationRoutesDeps {
  publishTask?: (stream: string, payload: Record<string, unknown>) => Promise<string>;
}

export function createConversationRoutes(deps?: ConversationRoutesDeps) {
  const publisher = deps?.publishTask ?? publishTask;

  return new Elysia({ prefix: '/api/v1/conversations' })
    .use(authPlugin)
    .get(
      '/',
      async ({ query }) => {
        const rawLimit = query.limit ? parseInt(query.limit, 10) : undefined;
        const rawOffset = query.offset ? parseInt(query.offset, 10) : undefined;
        const rawClientId = query.clientId ?? query.client_id;
        const parsedClientId = rawClientId ? parseInt(rawClientId, 10) : undefined;

        const limit = rawLimit !== undefined && !Number.isNaN(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : undefined;
        const offset = rawOffset !== undefined && !Number.isNaN(rawOffset) ? Math.max(0, rawOffset) : undefined;
        const clientId = parsedClientId !== undefined && !Number.isNaN(parsedClientId) ? parsedClientId : undefined;

        const conversations = await listConversations({
          platform: query.platform,
          clientId,
          status: query.status,
          limit,
          offset,
        });

        return {
          conversations,
          data: conversations,
        };
      },
      {
        isAuth: true,
        query: t.Object({
          platform: t.Optional(t.String()),
          clientId: t.Optional(t.String()),
          client_id: t.Optional(t.String()),
          status: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )
    .get(
      '/:id',
      async ({ params, set }) => {
        const conversationId = Number(params.id);
        if (Number.isNaN(conversationId) || conversationId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_CONVERSATION_ID',
              message: 'Conversation ID must be a positive integer',
            },
          };
        }

        const convWithClient = await getConversationWithClient(conversationId);
        if (!convWithClient) {
          const conv = await getConversationById(conversationId);
          if (!conv) {
            set.status = 404;
            return {
              error: {
                code: 'NOT_FOUND',
                message: 'Conversation not found',
              },
            };
          }
          return {
            conversation: conv,
            client: null,
          };
        }

        return {
          conversation: {
            ...convWithClient.conversation,
            clientUsername: convWithClient.clientUsername,
          },
          client: {
            id: convWithClient.clientId,
            username: convWithClient.clientUsername,
          },
        };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    )
    .get(
      '/:id/messages',
      async ({ params, query, set }) => {
        const conversationId = Number(params.id);
        if (Number.isNaN(conversationId) || conversationId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_CONVERSATION_ID',
              message: 'Conversation ID must be a positive integer',
            },
          };
        }

        const conv = await getConversationById(conversationId);
        if (!conv) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Conversation not found',
            },
          };
        }

        const rawLimit = query.limit ? parseInt(query.limit, 10) : 50;
        const limit = Math.min(100, Math.max(1, Number.isNaN(rawLimit) ? 50 : rawLimit));
        let messages = await getMessagesByConversationId(conversationId, limit);
        if (query.order === 'desc') {
          messages = [...messages].reverse();
        }

        return {
          messages,
          data: messages,
        };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
        query: t.Object({
          limit: t.Optional(t.String()),
          order: t.Optional(t.String()),
        }),
      }
    )
    .post(
      '/sync',
      async ({ body, currentUser, set }) => {
        const task = await createTask({
          userId: currentUser!.id,
          type: TaskType.READ_VGEN_CONVERSATION,
          input: { clientUsername: body.username, requestedBy: 'api' },
          idempotencyKey: `read_vgen:${body.username}:${crypto.randomUUID()}`,
        });

        await publisher(STREAMS.BROWSER, {
          type: String(TaskType.READ_VGEN_CONVERSATION),
          taskId: String(task.id),
        });

        set.status = 202;
        return { taskId: String(task.id), status: 'queued' };
      },
      {
        isAuth: true,
        body: t.Object({
          username: t.String({ minLength: 1, maxLength: 255 }),
        }),
      }
    )
    .post(
      '/:id/sync',
      async ({ params, currentUser, set }) => {
        const conversationId = Number(params.id);
        const conversation = await getConversationById(conversationId);
        if (!conversation) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Conversation not found',
            },
          };
        }

        const task = await createTask({
          userId: currentUser!.id,
          type: TaskType.SYNC_CONVERSATION,
          input: { conversationId, requestedBy: 'api' },
          idempotencyKey: `sync_conversation:${conversationId}:${crypto.randomUUID()}`,
        });

        await publisher(STREAMS.BROWSER, {
          type: String(TaskType.SYNC_CONVERSATION),
          taskId: String(task.id),
        });

        set.status = 202;
        return { taskId: String(task.id), status: 'queued' };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    );
}

export const conversationRoutes = createConversationRoutes();
