import type { AgentTaskRow, db } from '@client-agent/db';
import { findTaskByIdempotencyKey } from '@client-agent/db';
import { TaskStatus } from '@client-agent/domain';

export interface IdempotencyClaimResult {
  canExecute: boolean;
  existingTask: AgentTaskRow | null;
}

export async function checkAndClaimIdempotency(
  database: typeof db,
  idempotencyKey: string,
): Promise<IdempotencyClaimResult> {
  const existing = await findTaskByIdempotencyKey(idempotencyKey);
  if (!existing) {
    return { canExecute: true, existingTask: null };
  }

  if (existing.status === TaskStatus.COMPLETED || existing.status === TaskStatus.RUNNING) {
    return { canExecute: false, existingTask: existing };
  }

  return { canExecute: true, existingTask: existing };
}
