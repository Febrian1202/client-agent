import {
  createTask,
  findTaskByIdempotencyKey,
  getEventById,
  getTaskById,
  markEventProcessed,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  upsertClient,
} from '@client-agent/db';
import { TaskStatus, TaskType, type VGenEventPayload } from '@client-agent/domain';
import { STREAMS, publishTask, type ParsedTask } from '@client-agent/queue';

export interface ProcessGmailEventDeps {
  notificationsStream?: string;
}

export async function handleProcessGmailEvent(
  task: ParsedTask,
  deps?: ProcessGmailEventDeps,
): Promise<void> {
  const taskId = Number(task.data.taskId);
  if (Number.isNaN(taskId)) {
    throw new Error('PROCESS_GMAIL_EVENT message missing taskId');
  }

  const taskRow = await getTaskById(taskId);
  if (!taskRow) {
    throw new Error(`PROCESS_GMAIL_EVENT task ${taskId} not found`);
  }

  if (taskRow.status === TaskStatus.COMPLETED) {
    return;
  }

  try {
    await markTaskRunning(taskId);

    const event = taskRow.eventId === null ? null : await getEventById(taskRow.eventId);
    if (!event) {
      throw new Error(`PROCESS_GMAIL_EVENT task ${taskId} references a missing event`);
    }

    const payload: VGenEventPayload = event.payload;
    if (typeof payload.clientUsername === 'string' && payload.clientUsername.length > 0) {
      await upsertClient({
        userId: taskRow.userId,
        platform: 'vgen',
        username: payload.clientUsername,
      });
    }

    // Invariant: at most one NOTIFY_DISCORD task per event.
    // Check-then-create assumes Phase 1's single worker process; a DB-level guard is Phase 2 work.
    const notifyIdempotencyKey = `gmail_event:${event.id}:notify`;
    const existingNotifyTask = await findTaskByIdempotencyKey(notifyIdempotencyKey);
    const notifyTask =
      existingNotifyTask ??
      (await createTask({
        userId: taskRow.userId,
        eventId: event.id,
        type: TaskType.NOTIFY_DISCORD,
        input: { eventId: event.id },
        idempotencyKey: notifyIdempotencyKey,
      }));

    if (!existingNotifyTask || existingNotifyTask.status !== TaskStatus.COMPLETED) {
      await publishTask(deps?.notificationsStream ?? STREAMS.NOTIFICATIONS, {
        type: TaskType.NOTIFY_DISCORD,
        taskId: String(notifyTask.id),
      });
    }

    await markEventProcessed(event.id);
    await markTaskCompleted(taskId, { eventId: event.id, notifyTaskId: notifyTask.id });
  } catch (err) {
    await markTaskFailed(taskId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
