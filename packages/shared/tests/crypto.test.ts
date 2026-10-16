import { describe, expect, it } from 'bun:test';
import { generateId, hashPassword, verifyPassword } from '../src/index';

describe('Shared Crypto and ID Utilities', () => {
  it('hashes and successfully verifies a password with Argon2', async () => {
    const password = 'mySecretPassword123';
    const hash = await hashPassword(password);

    expect(hash).toBeString();
    expect(hash.startsWith('$argon2id$')).toBeTrue();

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBeTrue();

    const isInvalid = await verifyPassword('wrongPassword', hash);
    expect(isInvalid).toBeFalse();
  });

  it('generates unique random IDs with optional prefix', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).toBeString();
    expect(id2).toBeString();
    expect(id1).not.toBe(id2);

    const taskId = generateId('task');
    expect(taskId.startsWith('task_')).toBeTrue();
  });
});
