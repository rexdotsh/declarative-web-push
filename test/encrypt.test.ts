import { expect, test } from 'bun:test';
import { decrypt } from 'http_ece';
import { utf8 } from '../src/encoding.js';
import { MAX_PAYLOAD_BYTES, encrypt } from '../src/server/encrypt.js';
import { newReceiver } from './keys.js';

test('round-trips through the RFC 8188 reference implementation', async () => {
  const receiver = newReceiver();
  const plaintext = JSON.stringify({ title: 'Pay rent 🏠', body: 'x'.repeat(2000) });

  const body = await encrypt(utf8(plaintext), receiver.target);
  const decrypted = decrypt(Buffer.from(body), {
    version: 'aes128gcm',
    privateKey: receiver.ecdh,
    authSecret: Buffer.from(receiver.auth),
  });

  expect(decrypted.toString()).toBe(plaintext);
});

test('fills a push body up to 4096 bytes and rejects anything larger', async () => {
  const receiver = newReceiver();
  const largest = await encrypt(new Uint8Array(MAX_PAYLOAD_BYTES), receiver.target);

  expect(largest.length).toBe(4096);
  expect(
    await encrypt(new Uint8Array(MAX_PAYLOAD_BYTES + 1), receiver.target).catch((error: unknown) => error),
  ).toBeInstanceOf(RangeError);
});
