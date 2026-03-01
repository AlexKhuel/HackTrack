'use strict';

const crypto = require('crypto');

const KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const ENVELOPE_VERSION = 'v1';

function decodeEncryptionKey(rawKey) {
  const keyText = String(rawKey || '').trim();
  if (!keyText) {
    throw new Error('Missing OPENNOTE_TOKEN_ENCRYPTION_KEY in environment');
  }

  const base64Decoded = Buffer.from(keyText, 'base64');
  if (base64Decoded.length === KEY_BYTES && base64Decoded.toString('base64') === keyText) {
    return base64Decoded;
  }

  if (/^[0-9a-fA-F]{64}$/.test(keyText)) {
    return Buffer.from(keyText, 'hex');
  }

  const utf8Decoded = Buffer.from(keyText, 'utf8');
  if (utf8Decoded.length === KEY_BYTES) {
    return utf8Decoded;
  }

  throw new Error('OPENNOTE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64, hex, or raw text)');
}

function loadEncryptionKey() {
  return decodeEncryptionKey(process.env.OPENNOTE_TOKEN_ENCRYPTION_KEY);
}

function encryptString(plainText, key = loadEncryptionKey()) {
  const text = String(plainText ?? '');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENVELOPE_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptString(encryptedValue, key = loadEncryptionKey()) {
  const text = String(encryptedValue || '').trim();
  const parts = text.split(':');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Encrypted OpenNote token has invalid format');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  if (iv.length !== IV_BYTES || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Encrypted OpenNote token has invalid payload');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

module.exports = {
  decryptString,
  decodeEncryptionKey,
  encryptString,
  loadEncryptionKey,
};
