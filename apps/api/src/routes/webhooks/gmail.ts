import { Elysia } from 'elysia';
import { config } from '@client-agent/config';
import {
  createTask,
  getIntegration,
  getOwnerUserId,
  insertEventIfNew,
  upsertIntegration,
} from '@client-agent/db';
import { TaskType } from '@client-agent/domain';
import {
  GmailApiError,
  GmailHistoryExpiredError,
  PubSubPayloadError,
  type GmailClient,
  type PubSubPushBody,
  parseGmailPushNotification,
  parseVGenEmail,
  verifyPubSubPushToken,
} from '@client-agent/gmail';
import { publishTask, STREAMS } from '@client-agent/queue';

const MAX_MESSAGES_PER_PUSH = 25;
const GMAIL_PROVIDER = 'gmail';

export interface GmailWebhookDeps {
  resolveGmailClient: () => Promise<GmailClient | null>;
  audience?: string | null;
  verifyToken?: (options: { token: string; audience: string }) => Promise<{ email: string }>;
  eventsStream?: string;
}

export function createGmailWebhookRoutes(deps: GmailWebhookDeps) {
  const audience =
    deps.audience !== undefined ? deps.audience : config.GOOGLE_PUBSUB_AUDIENCE;
  const eventsStream = deps.eventsStream ?? STREAMS.EVENTS;
  const verifyToken = deps.verifyToken ?? verifyPubSubPushToken;

  if (!audience) {
    console.warn('[gmail-webhook] GOOGLE_PUBSUB_AUDIENCE is not set; skipping push token verification');
  }

  return new Elysia().post(
    '/api/v1/webhooks/google/gmail',
    async ({ body, headers, set }) => {
      if (audience) {
        const authorization = headers['authorization'] ?? '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';

        if (!token) {
          set.status = 401;
          return { error: { code: 'UNAUTHORIZED' } };
        }

        try {
          await verifyToken({ token, audience });
        } catch (error) {
          console.warn(
            `[gmail-webhook] rejected Pub/Sub push: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
          set.status = 401;
          return { error: { code: 'UNAUTHORIZED' } };
        }
      }

      let push;
      try {
        push = parseGmailPushNotification(body as PubSubPushBody);
      } catch (error) {
        if (error instanceof PubSubPayloadError) {
          set.status = 400;
          return { error: { code: 'INVALID_PUBSUB_PAYLOAD' } };
        }
        throw error;
      }

      const userId = await getOwnerUserId();
      const integration = await getIntegration(userId, GMAIL_PROVIDER);
      if (!integration || integration.status !== 'connected') {
        return { ok: false, reason: 'gmail_not_connected' };
      }

      const client = await deps.resolveGmailClient();
      if (!client) {
        return { ok: false, reason: 'gmail_not_connected' };
      }

      const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
      const storedHistoryId =
        typeof metadata.lastHistoryId === 'string' ? metadata.lastHistoryId : null;

      const persistIntegration = (next: Record<string, unknown>) =>
        upsertIntegration({
          userId,
          provider: GMAIL_PROVIDER,
          status: integration.status,
          credentialsEncrypted: integration.credentialsEncrypted,
          metadata: next,
        });

      const markIntegrationError = async () => {
        await upsertIntegration({
          userId,
          provider: GMAIL_PROVIDER,
          status: 'error',
          metadata: metadata,
          credentialsEncrypted: integration.credentialsEncrypted,
        });
        return { ok: false as const, reason: 'gmail_api_error' as const };
      };

      const bootstrap = async () => {
        const profile = await client.getProfile();
        await persistIntegration({
          ...metadata,
          emailAddress: profile.emailAddress,
          lastHistoryId: profile.historyId,
        });
        return { ok: true as const, bootstrapped: true as const };
      };

      const bootstrapSafely = async () => {
        try {
          return await bootstrap();
        } catch (error) {
          if (error instanceof GmailApiError) {
            return markIntegrationError();
          }
          throw error;
        }
      };

      const processMessages = async (messageIds: string[], historyId: string) => {
        let inserted = 0;

        for (const messageId of messageIds.slice(0, MAX_MESSAGES_PER_PUSH)) {
          let parsed;
          try {
            parsed = parseVGenEmail(await client.fetchMessageById(messageId));
          } catch (error) {
            if (error instanceof GmailApiError) {
              console.warn(
                `[gmail-webhook] failed to fetch message ${messageId}: ${error.message}`,
              );
              continue;
            }
            throw error;
          }

          if (!parsed) {
            continue;
          }

          const row = await insertEventIfNew({
            source: 'gmail',
            provider: 'vgen',
            eventType: parsed.eventType,
            externalId: parsed.externalId,
            receivedAt: parsed.receivedAt,
            payload: {
              subject: parsed.subject,
              from: parsed.from,
              date: parsed.receivedAt.toISOString(),
              clientUsername: parsed.clientUsername,
              commissionId: parsed.commissionId,
              historyId,
            },
          });

          if (!row) {
            continue;
          }

          const task = await createTask({
            userId,
            eventId: row.id,
            type: TaskType.PROCESS_GMAIL_EVENT,
            input: { eventId: row.id },
            idempotencyKey: `gmail_event:${row.id}:process`,
          });
          await publishTask(eventsStream, {
            type: TaskType.PROCESS_GMAIL_EVENT,
            taskId: String(task.id),
          });
          inserted += 1;
        }

        return inserted;
      };

      if (!storedHistoryId) {
        return bootstrapSafely();
      }

      let history;
      try {
        history = await client.listHistory(storedHistoryId);
      } catch (error) {
        if (error instanceof GmailHistoryExpiredError) {
          return bootstrapSafely();
        }
        if (error instanceof GmailApiError) {
          return markIntegrationError();
        }
        throw error;
      }

      const inserted = await processMessages(history.messageIds, push.historyId);
      await persistIntegration({ ...metadata, lastHistoryId: push.historyId });

      return { ok: true, events: inserted };
    }
  );
}
