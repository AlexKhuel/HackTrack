'use strict';

const {
  decryptString,
  encryptString,
} = require('../crypto');

describe('OpenNote token encryption', () => {
  beforeEach(() => {
    process.env.OPENNOTE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  test('round-trips encrypted values', () => {
    const encrypted = encryptString('secret-token-123');
    expect(encrypted).toMatch(/^v1:/);

    const decrypted = decryptString(encrypted);
    expect(decrypted).toBe('secret-token-123');
  });

  test('fails when ciphertext is tampered', () => {
    const encrypted = encryptString('secret-token-123');
    const parts = encrypted.split(':');
    parts[3] = `${parts[3].slice(0, -2)}AA`;

    expect(() => decryptString(parts.join(':'))).toThrow();
  });
});
