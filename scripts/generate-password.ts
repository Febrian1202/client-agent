import { hashPassword } from '@client-agent/shared';

const inputPassword = process.argv[2];

if (!inputPassword) {
  console.log('Penggunaan:');
  console.log('  bun run scripts/generate-password.ts <password-anda>');
  console.log('');
  console.log('Contoh:');
  console.log('  bun run scripts/generate-password.ts "Rahasia123!"');
  process.exit(1);
}

const rawHash = await hashPassword(inputPassword);
const envEscapedHash = rawHash.replaceAll('$', '\\$');
const newSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

console.log('=====================================================');
console.log('🔑 Password Hash Berhasil Dibuat (Argon2id)');
console.log('=====================================================');
console.log(`Password Plaintext : ${inputPassword}`);
console.log(`Hash Asli (Argon2id): ${rawHash}`);
console.log('-----------------------------------------------------');
console.log('Salin baris berikut ke file .env Anda:');
console.log('-----------------------------------------------------');
console.log(`AUTH_PASSWORD_HASH='${envEscapedHash}'`);
console.log('');
console.log('(Opsional) Jika ingin memperbarui AUTH_SECRET juga:');
console.log(`AUTH_SECRET=${newSecret}`);
console.log('=====================================================');
