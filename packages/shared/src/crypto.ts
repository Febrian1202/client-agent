export function sha256Hex(input: string): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex').toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: 65536,
    timeCost: 2,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  let cleanHash = hash.trim();
  if (
    (cleanHash.startsWith("'") && cleanHash.endsWith("'")) ||
    (cleanHash.startsWith('"') && cleanHash.endsWith('"'))
  ) {
    cleanHash = cleanHash.slice(1, -1);
  }
  cleanHash = cleanHash.replaceAll('\\$', '$');

  try {
    return await Bun.password.verify(password, cleanHash);
  } catch {
    return false;
  }
}
