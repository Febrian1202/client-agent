const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_TTL_SECONDS = 3600;
const DEFAULT_TOLERANCE_SECONDS = 60;
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export interface PubSubPushBody {
  message: { data: string; messageId?: string; publishTime?: string };
  subscription?: string;
}

export interface GmailPushNotification {
  emailAddress: string;
  historyId: string;
}

export class PubSubPayloadError extends Error {
  constructor(message = 'Invalid Pub/Sub push payload') {
    super(message);
    this.name = 'PubSubPayloadError';
  }
}

export class PubSubAuthError extends Error {
  constructor(message = 'Invalid Pub/Sub push token') {
    super(message);
    this.name = 'PubSubAuthError';
  }
}

interface JwksKey {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

interface JwksDocument {
  keys?: JwksKey[];
}

const jwksCache = new Map<string, { expiresAt: number; keys: JwksKey[] }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  if (normalized.length % 4 === 1 || !BASE64_PATTERN.test(padded)) {
    throw new PubSubPayloadError('Pub/Sub message data is not valid base64');
  }

  return Buffer.from(padded, 'base64').toString('utf8');
}

export function decodePubSubData(body: PubSubPushBody): Record<string, unknown> {
  const data = body?.message?.data;
  if (typeof data !== 'string') {
    throw new PubSubPayloadError('Pub/Sub push body has no message data');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64(data));
  } catch (error) {
    if (error instanceof PubSubPayloadError) {
      throw error;
    }
    throw new PubSubPayloadError('Pub/Sub message data is not valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new PubSubPayloadError('Pub/Sub message data is not a JSON object');
  }
  return parsed;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'string') {
    return value === '' ? null : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function parseGmailPushNotification(body: PubSubPushBody): GmailPushNotification {
  const payload = decodePubSubData(body);
  const emailAddress = identifier(payload.emailAddress);
  const historyId = identifier(payload.historyId);

  if (emailAddress === null || historyId === null) {
    throw new PubSubPayloadError('Pub/Sub notification is missing emailAddress or historyId');
  }

  return { emailAddress, historyId };
}

function decodeJsonObject(segment: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

async function resolveJwksKeys(options: {
  jwksUrl: string;
  fetchImpl: typeof fetch;
  now: () => number;
  useCache: boolean;
}): Promise<JwksKey[]> {
  const cached = options.useCache ? jwksCache.get(options.jwksUrl) : undefined;
  if (cached && cached.expiresAt > options.now()) {
    return cached.keys;
  }

  const response = await options.fetchImpl(options.jwksUrl);
  if (!response.ok) {
    throw new PubSubAuthError(`Google JWKS request failed with status ${response.status}`);
  }

  const document = (await response.json()) as JwksDocument;
  const keys = Array.isArray(document.keys) ? document.keys : [];

  if (options.useCache && keys.length > 0) {
    jwksCache.set(options.jwksUrl, { expiresAt: options.now() + JWKS_CACHE_TTL_SECONDS, keys });
  }

  return keys;
}

export async function verifyPubSubPushToken(options: {
  token: string;
  audience: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  jwksUrl?: string;
  toleranceSeconds?: number;
}): Promise<{ email: string }> {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const jwksUrl = options.jwksUrl ?? GOOGLE_JWKS_URL;

  const parts = options.token.split('.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    parts.length !== 3 ||
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    throw new PubSubAuthError('Push token is not a well-formed JWT');
  }

  const header = decodeJsonObject(encodedHeader);
  const payload = decodeJsonObject(encodedPayload);
  if (!header || !payload) {
    throw new PubSubAuthError('Push token header or payload is not a JSON object');
  }
  if (header.alg !== 'RS256') {
    throw new PubSubAuthError('Push token is not signed with RS256');
  }

  const kid = header.kid;
  if (typeof kid !== 'string' || kid === '') {
    throw new PubSubAuthError('Push token has no key id');
  }

  const keys = await resolveJwksKeys({
    jwksUrl,
    fetchImpl: options.fetchImpl ?? fetch,
    now,
    useCache: options.fetchImpl === undefined,
  });
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new PubSubAuthError('Push token is signed with an unknown key');
  }

  let signingKey: CryptoKey;
  try {
    signingKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new PubSubAuthError('Push token signing key could not be imported');
  }

  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    Buffer.from(encodedSignature, 'base64url'),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!signatureValid) {
    throw new PubSubAuthError('Push token signature is invalid');
  }

  const issuer = payload.iss;
  if (typeof issuer !== 'string' || !GOOGLE_ISSUERS.has(issuer)) {
    throw new PubSubAuthError('Push token issuer is not Google');
  }
  if (payload.aud !== options.audience) {
    throw new PubSubAuthError('Push token audience does not match');
  }

  const currentTime = now();
  const expiresAt = payload.exp;
  if (typeof expiresAt !== 'number' || expiresAt <= currentTime) {
    throw new PubSubAuthError('Push token has expired');
  }

  const issuedAt = payload.iat;
  if (typeof issuedAt === 'number' && issuedAt > currentTime + toleranceSeconds) {
    throw new PubSubAuthError('Push token was issued in the future');
  }

  return { email: typeof payload.email === 'string' ? payload.email : '' };
}
