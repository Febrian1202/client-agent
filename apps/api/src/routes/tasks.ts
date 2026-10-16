import { Elysia, t } from 'elysia';
import {
  getTaskById,
  listTasks,
  resetTaskForRetry,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { STREAMS, publishTask } from '@client-agent/queue';
import { authPlugin } from '../auth/plugin';

export interface TaskRoutesDeps {
  publishTask?: (stream: string, payload: Record<string, unknown>) => Promise<string>;
}

export function getStreamForTaskType(type: TaskType | string): string {
  switch (type) {
    case TaskType.PROCESS_GMAIL_EVENT:
      return STREAMS.EVENTS;
    case TaskType.NOTIFY_DISCORD:
      return STREAMS.NOTIFICATIONS;
    case TaskType.READ_VGEN_CONVERSATION:
      return STREAMS.BROWSER;
    case TaskType.SYNC_CONVERSATION:
    case TaskType.SYNC_COMMISSION:
      return STREAMS.SYNC;
    case TaskType.GENERATE_SUMMARY:
    case TaskType.GENERATE_REPLY_DRAFT:
      return STREAMS.AGENT;
    case TaskType.SEND_VGEN_MESSAGE:
      return STREAMS.SEND;
    default:
      return STREAMS.EVENTS;
  }
}

export function createTaskRoutes(deps?: TaskRoutesDeps) {
  const publisher = deps?.publishTask ?? publishTask;

  return new Elysia({ prefix: '/api/v1/agent/tasks' })
    .use(authPlugin)
    .get(
      '/',
      async ({ query }) => {
        const page = query.page ? parseInt(query.page, 10) : 1;
        const limit = query.limit ? parseInt(query.limit, 10) : 20;
        const status = query.status as TaskStatus | undefined;
        const type = query.type as TaskType | undefined;

        const result = await listTasks({
          page: Number.isNaN(page) ? 1 : page,
          limit: Number.isNaN(limit) ? 20 : limit,
          status,
          type,
        });

        return {
          tasks: result.tasks,
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        };
      },
      {
        isAuth: true,
        query: t.Object({
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          status: t.Optional(t.String()),
          type: t.Optional(t.String()),
        }),
      }
    )
    .get(
      '/:id',
      async ({ params, set }) => {
        const taskId = parseInt(params.id, 10);
        if (Number.isNaN(taskId) || taskId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_TASK_ID',
              message: 'Task ID must be a positive integer',
            },
          };
        }

        const task = await getTaskById(taskId);
        if (!task) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Task not found',
            },
          };
        }

        return { task };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.String(),
        }),
      }
    )
    .post(
      '/:id/retry',
      async ({ params, set }) => {
        const taskId = parseInt(params.id, 10);
        if (Number.isNaN(taskId) || taskId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_TASK_ID',
              message: 'Task ID must be a positive integer',
            },
          };
        }

        const task = await getTaskById(taskId);
        if (!task) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Task not found',
            },
          };
        }

        if (task.status !== TaskStatus.FAILED && task.status !== TaskStatus.DEAD) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_TASK_STATE',
              message: 'Only failed or dead tasks can be retried',
            },
          };
        }

        const resetTask = await resetTaskForRetry(taskId);
        if (!resetTask) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Task not found',
            },
          };
        }

        const stream = getStreamForTaskType(task.type);
        await publisher(stream, { taskId: String(task.id), type: task.type });

        return {
          task: resetTask,
          status: 're-queued',
        };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.String(),
        }),
      }
    );
}

export const taskRoutes = createTaskRoutes();
