import { describe, expect, it } from 'bun:test';
import { GmailApiError, GmailHistoryExpiredError, createGmailClient, extractHeader } from '../src/client';

const credentials = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' };

function stubFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler!(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const tokenResponse = () => new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 });

describe('Gmail REST client', () => {
  it('extracts headers case-insensitively and tolerates missing ones', () => {
    expect(extractHeader([{ name: 'subject', value: 'Hi' }], 'Subject')).toBe('Hi');
    expect(extractHeader(undefined, 'From')).toBe('');
  });

  it('refreshes once and reuses the access token across calls', async () => {
    const { fetchImpl, calls } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({ emailAddress: 'me@example.com', historyId: '1000' }), { status: 200 }),
      () => new Response(JSON.stringify({ emailAddress: 'me@example.com', historyId: '1000' }), { status: 200 }),
    ]);
    const client = createGmailClient({ credentials, fetchImpl });
    expect(await client.getProfile()).toEqual({ emailAddress: 'me@example.com', historyId: '1000' });
    await client.getProfile();
    expect(calls.filter((url) => url.includes('oauth2.googleapis.com')).length).toBe(1);
    expect(calls.filter((url) => url.includes('/users/me/profile')).length).toBe(2);
  });

  it('maps a message payload to plain subject/from/date fields', async () => {
    const { fetchImpl, calls } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({
        id: 'msg-1', threadId: 'th-1',
        payload: { headers: [
          { name: 'Subject', value: '@ErianOsamu sent you a new message!' },
          { name: 'From', value: 'VGen <no-reply@vgen.co>' },
          { name: 'Date', value: 'Thu, 16 Oct 2026 14:32:11 +0000' },
        ] },
      }), { status: 200 }),
    ]);
    const message = await createGmailClient({ credentials, fetchImpl }).fetchMessageById('msg-1');
    expect(message).toEqual({ id: 'msg-1', threadId: 'th-1', subject: '@ErianOsamu sent you a new message!', from: 'VGen <no-reply@vgen.co>', date: 'Thu, 16 Oct 2026 14:32:11 +0000' });
    const requestUrl = calls[1]!;
    expect(requestUrl).toContain('/users/me/messages/msg-1');
    expect(requestUrl).toContain('format=metadata');
    expect(requestUrl).toContain('metadataHeaders=Subject');
  });

  it('flattens and de-duplicates added messages from history', async () => {
    const { fetchImpl } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({
        historyId: '1010',
        history: [
          { messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'b' } }] },
          { messagesAdded: [{ message: { id: 'b' } }] },
        ],
      }), { status: 200 }),
    ]);
    const history = await createGmailClient({ credentials, fetchImpl }).listHistory('1000');
    expect(history.messageIds).toEqual(['a', 'b']);
    expect(history.latestHistoryId).toBe('1010');
  });

  it('maps a 404 on history to GmailHistoryExpiredError', async () => {
    const { fetchImpl } = stubFetch([
      tokenResponse,
      () => new Response(JSON.stringify({ error: { message: 'historyId too old' } }), { status: 404 }),
    ]);
    await expect(createGmailClient({ credentials, fetchImpl }).listHistory('1')).rejects.toBeInstanceOf(GmailHistoryExpiredError);
  });

  it('retries once with a fresh token after a 401', async () => {
    const { fetchImpl, calls } = stubFetch([
      tokenResponse,
      () => new Response('unauthorized', { status: 401 }),
      tokenResponse,
      () => new Response(JSON.stringify({ emailAddress: 'me@example.com', historyId: '2' }), { status: 200 }),
    ]);
    const client = createGmailClient({ credentials, fetchImpl });
    expect((await client.getProfile()).historyId).toBe('2');
    expect(calls.filter((url) => url.includes('oauth2.googleapis.com')).length).toBe(2);
  });

  it('throws GmailApiError with the upstream status', async () => {
    const { fetchImpl } = stubFetch([
      () => new Response('invalid_grant', { status: 400 }),
    ]);
    await expect(createGmailClient({ credentials, fetchImpl }).getProfile()).rejects.toBeInstanceOf(GmailApiError);
  });
});
