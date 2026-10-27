import { createECDH } from 'node:crypto';
import { toBase64url } from '../src/encoding.js';

export function newReceiver() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    ecdh,
    auth,
    target: { p256dh: toBase64url(new Uint8Array(ecdh.getPublicKey())), auth: toBase64url(auth) },
  };
}
