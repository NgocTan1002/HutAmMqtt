import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CredentialCipher,
  InvalidCredentialCiphertextError,
  isEncryptedCredential,
} from './credential-cipher.js';

test('CredentialCipher encrypts and decrypts without storing plaintext', () => {
  const cipher = CredentialCipher.fromBase64(CredentialCipher.generateKey());
  const plaintext = 'Mật khẩu MQTT 123!';
  const encrypted = cipher.encrypt(plaintext);

  assert.equal(isEncryptedCredential(encrypted), true);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(cipher.decrypt(encrypted), plaintext);
});

test('CredentialCipher uses a unique IV for each encryption', () => {
  const cipher = CredentialCipher.fromBase64(CredentialCipher.generateKey());
  const first = cipher.encrypt('same-password');
  const second = cipher.encrypt('same-password');

  assert.notEqual(first, second);
  assert.equal(cipher.decrypt(first), 'same-password');
  assert.equal(cipher.decrypt(second), 'same-password');
});

test('CredentialCipher rejects tampering and a different key', () => {
  const cipher = CredentialCipher.fromBase64(CredentialCipher.generateKey());
  const anotherCipher = CredentialCipher.fromBase64(CredentialCipher.generateKey());
  const encrypted = cipher.encrypt('secret');
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(() => cipher.decrypt(tampered), InvalidCredentialCiphertextError);
  assert.throws(() => anotherCipher.decrypt(encrypted), InvalidCredentialCiphertextError);
  assert.throws(() => cipher.decrypt('plaintext'), InvalidCredentialCiphertextError);
});

test('CredentialCipher validates key length', () => {
  assert.throws(
    () => CredentialCipher.fromBase64(Buffer.alloc(16).toString('base64')),
    /32-byte key/,
  );
});
