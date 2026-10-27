import { fromBase64url, utf8 } from '../encoding.js';
import type { PushSubscriptionKeys } from '../index.js';

const RECORD_SIZE = 4096;
const HEADER_BYTES = 86;
const TAG_BYTES = 16;

/** The largest payload that fits one 4096-byte aes128gcm record, the size every push service accepts. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - 1;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: ArrayBuffer | Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** RFC 8291 message encryption: one aes128gcm record (RFC 8188) keyed to the subscription. */
export async function encrypt(
  plaintext: Uint8Array,
  target: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`push payload is ${plaintext.length} bytes, the limit is ${MAX_PAYLOAD_BYTES}`);
  }
  const uaPublic = fromBase64url(target.p256dh);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const [rawPublic, shared] = await Promise.all([
    crypto.subtle.exportKey('raw', local.publicKey),
    crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256),
  ]);
  const asPublic = new Uint8Array(rawPublic);

  const ikm = await hkdf(fromBase64url(target.auth), shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const [cek, nonce] = await Promise.all([
    hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16),
    hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12),
  ]);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aes,
    concat(plaintext, new Uint8Array([2])),
  );

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, new Uint8Array(record));
}
