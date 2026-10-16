import { config } from '@client-agent/config';
import { getIntegration, getOwnerUserId } from '@client-agent/db';
import { createGmailClient, type GmailClient } from '@client-agent/gmail';
import { decryptSecret } from '@client-agent/shared';

export class GoogleNotConfiguredError extends Error {
  constructor(message = 'Google OAuth credentials are not configured') {
    super(message);
    this.name = 'GoogleNotConfiguredError';
  }
}

export async function resolveGmailClient(): Promise<GmailClient | null> {
  const userId = await getOwnerUserId();
  const integration = await getIntegration(userId, 'gmail');

  if (!integration || integration.status !== 'connected' || !integration.credentialsEncrypted) {
    return null;
  }

  const { refreshToken } = JSON.parse(
    await decryptSecret(integration.credentialsEncrypted, config.AUTH_SECRET),
  ) as { refreshToken: string };

  return createGmailClient({
    credentials: {
      refreshToken,
      clientId: config.GOOGLE_CLIENT_ID!,
      clientSecret: config.GOOGLE_CLIENT_SECRET!,
    },
  });
}
