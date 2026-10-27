import { expect, test } from 'bun:test';
import { fromBase64url, utf8 } from '../src/encoding.js';
import { generateVapidKeys, vapidAuthorization, vapidKeys } from '../src/server/vapid.js';

function decodeJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64url(part)));
}

test('signs an ES256 JWT for the push service origin that verifies with the advertised key', async () => {
  const keys = vapidKeys(await generateVapidKeys());
  const now = Date.UTC(2026, 0, 1);
  const header = await vapidAuthorization(
    'https://web.push.apple.com/QGuQyavXutnMH',
    { keys, subject: 'https://example.com' },
    now,
  );

  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  if (!match) throw new Error(`unexpected header: ${header}`);
  const [, head = '', claims = '', signature = '', publicKey = ''] = match;

  expect(publicKey).toBe(keys.publicKey);
  expect(decodeJson(head)).toEqual({ typ: 'JWT', alg: 'ES256' });
  expect(decodeJson(claims)).toEqual({
    aud: 'https://web.push.apple.com',
    exp: now / 1000 + 12 * 3600,
    sub: 'https://example.com',
  });

  const verifier = await crypto.subtle.importKey(
    'raw',
    fromBase64url(publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifier,
    fromBase64url(signature),
    utf8(`${head}.${claims}`),
  );
  expect(valid).toBe(true);
});

test('refuses keys that are not P-256 private JWKs', () => {
  expect(() => vapidKeys(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }))).toThrow(TypeError);
});
