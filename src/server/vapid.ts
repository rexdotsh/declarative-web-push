import { fromBase64url, toBase64url, utf8 } from '../encoding.js';
import { isRecord } from '../guards.js';

export interface VapidKeys {
  /** The uncompressed P-256 point, base64url: the `applicationServerKey` clients subscribe with. */
  publicKey: string;
  privateKey: Promise<CryptoKey>;
}

/** Who sends: the keys, and a contact for the push service, which RFC 8292 asks to be a `mailto:` or `https:` URL. */
export interface Vapid {
  keys: VapidKeys;
  subject: string;
}

interface PrivateEcJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d: string;
}

function isPrivateEcJwk(value: unknown): value is PrivateEcJwk {
  return (
    isRecord(value) &&
    value.kty === 'EC' &&
    value.crv === 'P-256' &&
    [value.x, value.y, value.d].every((part) => typeof part === 'string')
  );
}

/** A fresh VAPID key pair as the JSON of its private JWK, the one secret a sender keeps. */
export async function generateVapidKeys(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

const imported = new Map<string, VapidKeys>();

/** Imports the JSON of a P-256 private JWK once per key, so it is cheap to call on every request. */
export function vapidKeys(json: string): VapidKeys {
  let keys = imported.get(json);
  if (!keys) {
    const jwk: unknown = JSON.parse(json);
    if (!isPrivateEcJwk(jwk)) throw new TypeError('a VAPID key must be a P-256 private JWK');
    const point = new Uint8Array(65);
    point[0] = 4;
    point.set(fromBase64url(jwk.x), 1);
    point.set(fromBase64url(jwk.y), 33);
    keys = {
      publicKey: toBase64url(point),
      privateKey: crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
    };
    imported.set(json, keys);
  }
  return keys;
}

const JWT_LIFETIME_MS = 12 * 3600_000;
const JWT_RENEW_BEFORE_MS = 3600_000;
const jwts = new Map<string, { token: Promise<string>; expires: number }>();

function jwtPart(value: object): string {
  return toBase64url(utf8(JSON.stringify(value)));
}

async function signJwt(aud: string, vapid: Vapid, expires: number): Promise<string> {
  const unsigned = `${jwtPart({ typ: 'JWT', alg: 'ES256' })}.${jwtPart({ aud, exp: Math.floor(expires / 1000), sub: vapid.subject })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapid.keys.privateKey,
    utf8(unsigned),
  );
  return `${unsigned}.${toBase64url(new Uint8Array(signature))}`;
}

export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cacheKey = `${vapid.keys.publicKey} ${vapid.subject} ${aud}`;
  let jwt = jwts.get(cacheKey);
  if (!jwt || jwt.expires - now < JWT_RENEW_BEFORE_MS) {
    const expires = now + JWT_LIFETIME_MS;
    const token = signJwt(aud, vapid, expires);
    jwt = { token, expires };
    jwts.set(cacheKey, jwt);
    void token.catch(() => {
      if (jwts.get(cacheKey)?.token === token) jwts.delete(cacheKey);
    });
  }
  return `vapid t=${await jwt.token}, k=${vapid.keys.publicKey}`;
}
