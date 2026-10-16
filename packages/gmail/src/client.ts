import type { GmailClient, GmailMessage, GmailProfile, GoogleOAuthCredentials } from './types';

const API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

interface GmailMessageResource {
  id: string;
  threadId: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

interface GmailHistoryResource {
  historyId?: string;
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
}

export class GmailApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GmailApiError';
  }
}

export class GmailHistoryExpiredError extends Error {
  constructor(message = 'Gmail history is no longer available') {
    super(message);
    this.name = 'GmailHistoryExpiredError';
  }
}

export function extractHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  if (!headers) {
    return '';
  }
  const target = name.toLowerCase();
  const match = headers.find((header) => header.name.toLowerCase() === target);
  return match?.value ?? '';
}

async function apiError(response: Response): Promise<GmailApiError> {
  const detail = (await response.text()).trim();
  const message = `Gmail API request failed with status ${response.status}`;
  return new GmailApiError(response.status, detail ? `${message}: ${detail}` : message);
}

export async function refreshAccessToken(
  credentials: GoogleOAuthCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
  });

  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  const payload = (await response.json()) as TokenResponse;
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 0) * 1000),
  };
}

export function createGmailClient(options: {
  credentials: GoogleOAuthCredentials;
  fetchImpl?: typeof fetch;
}): GmailClient {
  const { credentials } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  let cachedToken: { accessToken: string; expiresAt: Date } | null = null;

  async function accessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_MARGIN_MS) {
      return cachedToken.accessToken;
    }
    cachedToken = await refreshAccessToken(credentials, fetchImpl);
    return cachedToken.accessToken;
  }

  async function authorizedFetch(path: string): Promise<Response> {
    const request = (token: string) =>
      fetchImpl(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });

    const response = await request(await accessToken());
    if (response.status !== 401) {
      return response;
    }

    cachedToken = null;
    return request(await accessToken());
  }

  return {
    async getProfile(): Promise<GmailProfile> {
      const response = await authorizedFetch('/users/me/profile');
      if (!response.ok) {
        throw await apiError(response);
      }
      const payload = (await response.json()) as GmailProfile;
      return { emailAddress: payload.emailAddress, historyId: payload.historyId };
    },

    async fetchMessageById(messageId: string): Promise<GmailMessage> {
      const params = new URLSearchParams({ format: 'metadata' });
      params.append('metadataHeaders', 'Subject');
      params.append('metadataHeaders', 'From');
      params.append('metadataHeaders', 'Date');

      const response = await authorizedFetch(
        `/users/me/messages/${encodeURIComponent(messageId)}?${params}`,
      );
      if (!response.ok) {
        throw await apiError(response);
      }

      const payload = (await response.json()) as GmailMessageResource;
      const headers = payload.payload?.headers;
      return {
        id: payload.id,
        threadId: payload.threadId,
        subject: extractHeader(headers, 'Subject'),
        from: extractHeader(headers, 'From'),
        date: extractHeader(headers, 'Date'),
      };
    },

    async listHistory(startHistoryId: string): Promise<{ messageIds: string[]; latestHistoryId: string }> {
      const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' });
      const response = await authorizedFetch(`/users/me/history?${params}`);

      if (response.status === 404) {
        throw new GmailHistoryExpiredError(`Gmail history expired for startHistoryId ${startHistoryId}`);
      }
      if (!response.ok) {
        throw await apiError(response);
      }

      const payload = (await response.json()) as GmailHistoryResource;
      const messageIds: string[] = [];
      const seen = new Set<string>();
      for (const entry of payload.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          const id = added.message?.id;
          if (id && !seen.has(id)) {
            seen.add(id);
            messageIds.push(id);
          }
        }
      }

      return { messageIds, latestHistoryId: payload.historyId ?? startHistoryId };
    },
  };
}
