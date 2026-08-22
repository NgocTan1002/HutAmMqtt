import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = 'enc:v1';
const AUTH_CONTEXT = Buffer.from('nhiet-am-mqtt:mqtt-password:v1', 'utf8');

export class InvalidCredentialCiphertextError extends Error {
  public constructor() {
    super('Encrypted credential is invalid or was created with another key.');
    this.name = 'InvalidCredentialCiphertextError';
  }
}

export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

export class CredentialCipher {
  private constructor(private readonly key: Buffer) {}

  public static fromBase64(encodedKey: string): CredentialCipher {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== encodedKey) {
      throw new Error('CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
    return new CredentialCipher(key);
  }

  public static generateKey(): string {
    return randomBytes(KEY_BYTES).toString('base64');
  }

  public encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(AUTH_CONTEXT);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    return [PREFIX, iv.toString('base64url'), authenticationTag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  public decrypt(ciphertext: string): string {
    try {
      const [marker, version, encodedIv, encodedTag, encodedValue, ...extra] = ciphertext.split(':');
      if (`${marker}:${version}` !== PREFIX || !encodedIv || !encodedTag || encodedValue === undefined || extra.length > 0) {
        throw new InvalidCredentialCiphertextError();
      }
      const iv = Buffer.from(encodedIv, 'base64url');
      const authenticationTag = Buffer.from(encodedTag, 'base64url');
      const encrypted = Buffer.from(encodedValue, 'base64url');
      if (iv.length !== IV_BYTES || authenticationTag.length !== 16) {
        throw new InvalidCredentialCiphertextError();
      }
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAAD(AUTH_CONTEXT);
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof InvalidCredentialCiphertextError) throw error;
      throw new InvalidCredentialCiphertextError();
    }
  }
}
