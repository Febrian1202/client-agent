import { describe, expect, it, beforeAll } from 'bun:test';
import { PubSubAuthError, PubSubPayloadError, decodePubSubData, parseGmailPushNotification, verifyPubSubPushToken } from '../src/pubsub';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const push = (payload: unknown) => ({ message: { data: b64(JSON.stringify(payload)) } });

let privateKey: CryptoKey;
let jwksFetch: typeof fetch;
const audience = 'https://agent.example.com/api/v1/webhooks/google/gmail';

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwksFetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] }), { status: 200 })) as typeof fetch;
});

async function signToken(claims: Record<string, unknown>) {
  const header = b64url({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' });
  const payload = b64url(claims);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}

const claims = () => ({ iss: 'https://accounts.google.com', aud: audience, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email: 'pubsub@project.iam.gserviceaccount.com' });

describe('Pub/Sub push handling', () => {
  it('decodes a base64 payload', () => {
    expect(decodePubSubData(push({ emailAddress: 'me@example.com', historyId: '12345' }))).toEqual({ emailAddress: 'me@example.com', historyId: '12345' });
  });

  it('rejects malformed payloads', () => {
    expect(() => decodePubSubData({ message: { data: 'not-base64-json' } })).toThrow(PubSubPayloadError);
    expect(() => parseGmailPushNotification(push({ emailAddress: 'me@example.com' }))).toThrow(PubSubPayloadError);
  });

  it('parses email address and history id as strings', () => {
    expect(parseGmailPushNotification(push({ emailAddress: 'me@example.com', historyId: 12345 }))).toEqual({ emailAddress: 'me@example.com', historyId: '12345' });
  });

  it('accepts a well-formed token from Google', async () => {
    const token = await signToken(claims());
    expect((await verifyPubSubPushToken({ token, audience, fetchImpl: jwksFetch })).email).toBe('pubsub@project.iam.gserviceaccount.com');
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signToken({ ...claims(), aud: 'https://evil.example.com' });
    await expect(verifyPubSubPushToken({ token, audience, fetchImpl: jwksFetch })).rejects.toBeInstanceOf(PubSubAuthError);
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await signToken({ ...claims(), exp: past, iat: past - 10 });
    await expect(verifyPubSubPushToken({ token, audience, fetchImpl: jwksFetch })).rejects.toBeInstanceOf(PubSubAuthError);
  });

  it('rejects a tampered signature', async () => {
    const token = await signToken(claims());
    const parts = token.split('.');
    const token2 = `${parts[0]}.${parts[1]}.${Buffer.from('forged').toString('base64url')}`;
    await expect(verifyPubSubPushToken({ token: token2, audience, fetchImpl: jwksFetch })).rejects.toBeInstanceOf(PubSubAuthError);
  });
});
