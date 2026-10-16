import { webcrypto } from 'node:crypto';

const FORMAT = 'v1';
const IV_LENGTH = 12;

async function deriveKey(secret: string) {
  const digest = await webcrypto.subtle.digest('SHA-256', Buffer.from(secret));
  return webcrypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    Buffer.from(plaintext),
  );
  return `${FORMAT}.${Buffer.from(iv).toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`;
}

export async function decryptSecret(payload: string, secret: string): Promise<string> {
  const parts = payload.split('.');
  const [format, ivSegment, ciphertextSegment] = parts;
  if (parts.length !== 3 || format !== FORMAT || !ivSegment || !ciphertextSegment) {
    throw new Error('Unsupported secret format');
  }
  const key = await deriveKey(secret);
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(ivSegment, 'base64url') },
    key,
    Buffer.from(ciphertextSegment, 'base64url'),
  );
  return Buffer.from(plaintext).toString('utf8');
}
