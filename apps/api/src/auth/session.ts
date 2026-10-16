import { getRedisClient } from '@client-agent/queue';
import { generateId } from '@client-agent/shared';
import type { SessionData } from '@client-agent/domain';

const SESSION_PREFIX = 'client-agent:session:';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function createSession(userId: number, username: string = 'creator'): Promise<string> {
  const sessionId = generateId('ses');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  const sessionData: SessionData = {
    userId,
    username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const redis = getRedisClient();
  await redis.set(
    `${SESSION_PREFIX}${sessionId}`,
    JSON.stringify(sessionData),
    'EX',
    SESSION_TTL_SECONDS
  );

  return sessionId;
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
  if (!sessionId) return null;
  const redis = getRedisClient();
  const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!data) return null;

  try {
    return JSON.parse(data) as SessionData;
  } catch {
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const redis = getRedisClient();
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
}
