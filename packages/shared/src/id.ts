import { randomUUID } from 'crypto';

export function generateId(prefix?: string): string {
  const uuid = randomUUID().replace(/-/g, '').slice(0, 16);
  return prefix ? `${prefix}_${uuid}` : uuid;
}
