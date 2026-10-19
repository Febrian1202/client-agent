import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { config } from '@client-agent/config';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { authPlugin } from './auth/plugin';
import { createGmailWebhookRoutes } from './routes/webhooks/gmail';
import { createIntegrationRoutes } from './routes/integrations';
import { resolveGmailClient, verifyGmailRefreshToken } from './services/gmail';
import { verifyDiscordChannel } from './services/discord';
import { taskRoutes } from './routes/tasks';
import { conversationRoutes } from './routes/conversations';
import { draftRoutes } from './routes/drafts';

export const app = new Elysia()
  .use(
    cors({
      origin: true,
      credentials: true,
    })
  )
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 422;
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'message' in error && typeof error.message === 'string' ? error.message : 'Validation failed',
          details: 'validator' in error ? error.validator : undefined,
        },
      };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
        },
      };
    }
    set.status = 500;
    const errorMessage =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : 'An unexpected error occurred';
    return {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: errorMessage,
      },
    };
  })
  .use(authPlugin)
  .use(healthRoutes)
  .use(authRoutes)
  .use(
    createGmailWebhookRoutes({
      resolveGmailClient,
      audience: config.GOOGLE_PUBSUB_AUDIENCE,
    })
  )
  .use(
    createIntegrationRoutes({
      verifyGmailRefreshToken,
      verifyDiscordChannel,
    })
  )
  .use(taskRoutes)
  .use(conversationRoutes)
  .use(draftRoutes);

export const createApp = () => app;
