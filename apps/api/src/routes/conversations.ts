import { Elysia, t } from 'elysia';
import { createTask, getConversationById } from '@client-agent/db';
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
