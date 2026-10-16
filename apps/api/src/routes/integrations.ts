import { Elysia, t } from 'elysia';
import { config } from '@client-agent/config';
import {
  deleteIntegration,
  getIntegration,
  getOwnerUserId,
  upsertIntegration,
  type IntegrationRow,
} from '@client-agent/db';
import { encryptSecret } from '@client-agent/shared';
import { authPlugin } from '../auth/plugin';
import { GoogleNotConfiguredError } from '../services/gmail';
import { DiscordNotConfiguredError } from '../services/discord';

export interface IntegrationDeps {
  verifyGmailRefreshToken(refreshToken: string): Promise<{ emailAddress: string; historyId: string }>;
  verifyDiscordChannel(channelId: string): Promise<{ id: string; name: string }>;
}

type Provider = 'gmail' | 'discord';

function serialize(provider: Provider, row: IntegrationRow | null) {
  const status = row?.status ?? 'disconnected';
  return {
    provider,
    status,
    connected: status === 'connected',
    metadata: (row?.metadata ?? {}) as Record<string, unknown>,
  };
}

export function createIntegrationRoutes(deps: IntegrationDeps) {
  return new Elysia({ prefix: '/api/v1/integrations' })
    .use(authPlugin)
    .get(
      '/',
      async () => {
        const userId = await getOwnerUserId();
        const [gmail, discord] = await Promise.all([
          getIntegration(userId, 'gmail'),
          getIntegration(userId, 'discord'),
        ]);

        return { data: [serialize('gmail', gmail), serialize('discord', discord)] };
      },
      { isAuth: true }
    )
    .post(
      '/gmail',
      async ({ body, set }) => {
        const userId = await getOwnerUserId();

        try {
          const profile = await deps.verifyGmailRefreshToken(body.refreshToken);

          await upsertIntegration({
            userId,
            provider: 'gmail',
            status: 'connected',
            credentialsEncrypted: await encryptSecret(
              JSON.stringify({ refreshToken: body.refreshToken }),
              config.AUTH_SECRET
            ),
            metadata: { emailAddress: profile.emailAddress, lastHistoryId: profile.historyId },
          });

          console.info('[integrations] gmail connected');

          return { data: { provider: 'gmail', status: 'connected', emailAddress: profile.emailAddress } };
        } catch (error) {
          set.status = 400;
          if (error instanceof GoogleNotConfiguredError) {
            return { error: { code: 'GOOGLE_NOT_CONFIGURED', message: error.message } };
          }
          return { error: { code: 'GMAIL_AUTH_FAILED', message: 'Failed to verify Gmail credentials' } };
        }
      },
      {
        isAuth: true,
        body: t.Object({
          refreshToken: t.String({ minLength: 1 }),
        }),
      }
    )
    .delete(
      '/gmail',
      async () => {
        const userId = await getOwnerUserId();
        await deleteIntegration(userId, 'gmail');
        console.info('[integrations] gmail disconnected');
        return { data: { provider: 'gmail', status: 'disconnected' } };
      },
      { isAuth: true }
    )
    .post(
      '/discord',
      async ({ body, set }) => {
        const userId = await getOwnerUserId();

        try {
          const channel = await deps.verifyDiscordChannel(body.channelId);

          await upsertIntegration({
            userId,
            provider: 'discord',
            status: 'connected',
            metadata: { channelId: channel.id, channelName: channel.name },
          });

          console.info('[integrations] discord connected');

          return {
            data: { provider: 'discord', status: 'connected', channelId: channel.id, channelName: channel.name },
          };
        } catch (error) {
          set.status = 400;
          if (error instanceof DiscordNotConfiguredError) {
            return { error: { code: 'DISCORD_NOT_CONFIGURED', message: error.message } };
          }
          return { error: { code: 'DISCORD_AUTH_FAILED', message: 'Failed to verify Discord channel' } };
        }
      },
      {
        isAuth: true,
        body: t.Object({
          channelId: t.String({ minLength: 1 }),
        }),
      }
    )
    .delete(
      '/discord',
      async () => {
        const userId = await getOwnerUserId();
        await deleteIntegration(userId, 'discord');
        console.info('[integrations] discord disconnected');
        return { data: { provider: 'discord', status: 'disconnected' } };
      },
      { isAuth: true }
    );
}
