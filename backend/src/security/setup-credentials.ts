import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import pg from 'pg';
import { CredentialCipher, isEncryptedCredential } from './credential-cipher.js';

const { Pool } = pg;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const environmentPath = resolve(projectRoot, '.env');
const temporaryEnvironmentPath = resolve(projectRoot, '.env.credentials.tmp');
const environmentText = await readFile(environmentPath, 'utf8');
const environment = parse(environmentText);

if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required in .env.');

const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  connectionTimeoutMillis: Number(environment.DATABASE_CONNECTION_TIMEOUT_MS || 5_000),
  max: 1,
  ssl: environment.DATABASE_SSL === 'true',
});

type PasswordRow = { id: string; encryptedPassword: string | null };
const current = await pool.query<PasswordRow>(`
  SELECT id, encrypted_password AS "encryptedPassword"
  FROM mqtt_connections
  WHERE encrypted_password IS NOT NULL
  ORDER BY id
`);

let encodedKey = environment.CONFIG_ENCRYPTION_KEY?.trim();
const hasEncryptedValues = current.rows.some(
  (row) => row.encryptedPassword !== null && isEncryptedCredential(row.encryptedPassword),
);
if (!encodedKey && hasEncryptedValues) {
  await pool.end();
  throw new Error('Encrypted MQTT passwords already exist, but CONFIG_ENCRYPTION_KEY is missing. Restore the original key.');
}
encodedKey ||= CredentialCipher.generateKey();
const cipher = CredentialCipher.fromBase64(encodedKey);

// Validate all existing ciphertext before changing either the database or .env.
for (const row of current.rows) {
  if (row.encryptedPassword && isEncryptedCredential(row.encryptedPassword)) {
    cipher.decrypt(row.encryptedPassword);
  }
}

const newline = environmentText.includes('\r\n') ? '\r\n' : '\n';
const keyLine = `CONFIG_ENCRYPTION_KEY=${encodedKey}`;
const updatedEnvironment = /^CONFIG_ENCRYPTION_KEY=.*$/m.test(environmentText)
  ? environmentText.replace(/^CONFIG_ENCRYPTION_KEY=.*$/m, keyLine)
  : `${environmentText.replace(/\s*$/, '')}${newline}CONFIG_ENCRYPTION_KEY=${encodedKey}${newline}`;
await writeFile(temporaryEnvironmentPath, updatedEnvironment, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryEnvironmentPath, environmentPath);

const client = await pool.connect();
let migrated = 0;
try {
  await client.query('BEGIN');
  for (const row of current.rows) {
    if (row.encryptedPassword === null || isEncryptedCredential(row.encryptedPassword)) continue;
    await client.query(
      'UPDATE mqtt_connections SET encrypted_password = $2, updated_at = NOW() WHERE id = $1',
      [row.id, cipher.encrypt(row.encryptedPassword)],
    );
    migrated += 1;
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}

console.log(`Credential setup completed. Encrypted ${migrated} existing MQTT password(s).`);
console.log('The encryption key was stored only in the local .env file and was not printed.');
