import { describe, expect, it } from 'bun:test';
import { generateId, hashPassword, sha256Hex, verifyPassword } from '../src/index';

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

    // Handles escaped dollar signs and enclosing quotes
    const escapedHash = `'${hash.replaceAll('$', '\\$')}'`;
    expect(await verifyPassword(password, escapedHash)).toBeTrue();

    // Gracefully handles malformed or unsupported hash without throwing
    expect(await verifyPassword(password, 'malformed_hash')).toBeFalse();
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

  it('hashes the known sha256 test vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces stable hex digests across calls and differs per input', () => {
    const first = sha256Hex('client-agent');
    const second = sha256Hex('client-agent');

    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('client-agent2')).not.toBe(first);
  });
});
