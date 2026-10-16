import {
  getEventById,
  getTaskById,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
} from '@client-agent/db';
import type { DiscordEventNotification, DiscordNotifier } from '@client-agent/discord';
import { TaskStatus, type VGenEventPayload } from '@client-agent/domain';
import type { ParsedTask } from '@client-agent/queue';

export interface NotifyDiscordDeps {
  notifier: DiscordNotifier;
  channelId: string;
}

export interface NotifyDiscordOutput {
  messageId: string;
  [key: string]: unknown;
}

export async function handleNotifyDiscord(
  task: ParsedTask,
  deps: NotifyDiscordDeps,
): Promise<NotifyDiscordOutput> {
  const taskId = Number(task.data.taskId);
  if (Number.isNaN(taskId)) {
    throw new Error('NOTIFY_DISCORD message missing taskId');
  }

  const taskRow = await getTaskById(taskId);
  if (!taskRow) {
    throw new Error(`NOTIFY_DISCORD task ${taskId} not found`);
  }

  if (taskRow.status === TaskStatus.COMPLETED) {
    return (taskRow.output as NotifyDiscordOutput) ?? { messageId: '' };
  }

  const isStandalone = taskRow.status !== TaskStatus.RUNNING;

  try {
    if (isStandalone) {
      await markTaskRunning(taskId);
    }

    const event = taskRow.eventId === null ? null : await getEventById(taskRow.eventId);
    if (!event) {
      throw new Error(`NOTIFY_DISCORD task ${taskId} references a missing event`);
    }

    const payload: VGenEventPayload = event.payload;
    const notification: DiscordEventNotification = {
      eventType: event.eventType,
      clientUsername: payload.clientUsername,
      commissionId: payload.commissionId,
      subject: payload.subject,
      receivedAt: event.receivedAt,
    };

    const { messageId } = await deps.notifier.sendEventNotification(deps.channelId, notification);
    const output: NotifyDiscordOutput = { messageId };

    if (isStandalone) {
      await markTaskCompleted(taskId, output);
    }

    return output;
  } catch (err) {
    if (isStandalone) {
      await markTaskFailed(taskId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}
