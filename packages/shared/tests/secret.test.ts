import { describe, expect, it } from 'bun:test';
import { decryptSecret, encryptSecret } from '../src/secret';

describe('secret encryption', () => {
  const secret = 'test_secret_key';

  it('round-trips a plaintext payload', async () => {
    const sealed = await encryptSecret('{"refreshToken":"1//abc"}', secret);
    expect(await decryptSecret(sealed, secret)).toBe('{"refreshToken":"1//abc"}');
  });

  it('produces a v1 envelope with a fresh IV per call', async () => {
    const a = await encryptSecret('same', secret);
    const b = await encryptSecret('same', secret);
    expect(a.startsWith('v1.')).toBeTrue();
    expect(a).not.toBe(b);
    expect(a.split('.')).toHaveLength(3);
  });

  it('rejects a tampered payload', async () => {
    const sealed = await encryptSecret('sensitive', secret);
    const parts = sealed.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from('garbage').toString('base64url')}`;
    expect(decryptSecret(tampered, secret)).rejects.toThrow();
  });

  it('rejects the wrong secret', async () => {
    const sealed = await encryptSecret('sensitive', secret);
    expect(decryptSecret(sealed, 'other_secret')).rejects.toThrow();
  });

  it('rejects an unsupported envelope version', async () => {
    expect(decryptSecret('v2.iv.ciphertext', secret)).rejects.toThrow('Unsupported secret format');
  });
});
