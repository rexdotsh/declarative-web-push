import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { send, type SendResult } from '../src/server/send.js';
import { canReplace, isPushServiceEndpoint } from '../src/server/services.js';
import { generateVapidKeys, vapidKeys } from '../src/server/vapid.js';
import { newReceiver } from './keys.js';

test.each([
  ['https://web.push.apple.com/abc', true, false],
  ['https://push.apple.com/abc', true, false],
  ['https://fcm.googleapis.com/fcm/send/abc', true, true],
  ['https://wns2-par02p.notify.windows.com/w/?token=abc', true, true],
  ['https://updates.push.services.mozilla.com/wpush/v2/abc', true, true],
  ['http://web.push.apple.com/abc', false, false],
  ['https://evil.example/web.push.apple.com', false, false],
  ['https://push.apple.com.evil.example/abc', false, false],
  ['https://evil.example/fcm.googleapis.com', false, false],
  ['https://web.push.apple.com:8443/abc', false, false],
  ['https://user:pass@web.push.apple.com/abc', false, false],
  ['not a url', false, false],
] as const)('%s is a push service: %p, replaces by tag: %p', (endpoint, known, replaces) => {
  expect(isPushServiceEndpoint(endpoint)).toBe(known);
  expect(canReplace(endpoint)).toBe(replaces);
});

afterEach(() => mock.restore());

const PUSH_SERVICE = 'https://fcm.googleapis.com/fcm/send/abc';
const mistakes: [string, string, unknown][] = [
  ['an endpoint outside the allowlist', 'https://attacker.example/collect', { ttl: 60 }],
  ['an unknown urgency', PUSH_SERVICE, { ttl: 60, urgency: 'urgent' }],
  ['a negative ttl', PUSH_SERVICE, { ttl: -1 }],
  ['a fractional ttl', PUSH_SERVICE, { ttl: 1.5 }],
  ['a topic past 32 characters', PUSH_SERVICE, { ttl: 60, topic: 'x'.repeat(33) }],
  ['a topic outside base64url', PUSH_SERVICE, { ttl: 60, topic: 'a b' }],
];

test.each(mistakes)('send throws for %s without contacting anyone', async (_, endpoint, options) => {
  const fetchSpy = spyOn(globalThis, 'fetch');
  const vapid = { keys: vapidKeys(await generateVapidKeys()), subject: 'https://example.com' };
  const subscription = { ...newReceiver().target, endpoint };

  // @ts-expect-error JavaScript callers can pass anything.
  const outcome = await send(subscription, '{}', vapid, options).catch((error: unknown) => error);

  expect(outcome).toBeInstanceOf(Error);
  expect(fetchSpy).not.toHaveBeenCalled();
});

function broken() {
  return new ReadableStream({ start: (controller) => controller.error(new Error('connection reset')) });
}

const answers: [string, Response | Error, SendResult][] = [
  ['an accepted message', new Response(null, { status: 201 }), { status: 201, outcome: 'sent', detail: '' }],
  [
    'an expired subscription',
    new Response('expired', { status: 410 }),
    { status: 410, outcome: 'gone', detail: 'expired' },
  ],
  [
    'a busy push service',
    new Response('slow down', { status: 429 }),
    { status: 429, outcome: 'retry', detail: 'slow down' },
  ],
  [
    'a bad VAPID key',
    new Response('BadJwtToken', { status: 403 }),
    { status: 403, outcome: 'rejected', detail: 'BadJwtToken' },
  ],
  ['no answer', new TypeError('network down'), { status: 0, outcome: 'retry', detail: 'network down' }],
  [
    'an expired subscription whose body breaks off',
    new Response(broken(), { status: 410 }),
    { status: 410, outcome: 'gone', detail: '(the response body could not be read: connection reset)' },
  ],
  [
    'a refusal whose body breaks off',
    new Response(broken(), { status: 400 }),
    { status: 400, outcome: 'rejected', detail: '(the response body could not be read: connection reset)' },
  ],
];

test.each(answers)('send reports %s as a result, never by throwing', async (_, answer, expected) => {
  const fetchSpy = spyOn(globalThis, 'fetch');
  if (answer instanceof Error) fetchSpy.mockRejectedValue(answer);
  else fetchSpy.mockResolvedValue(answer);
  const vapid = { keys: vapidKeys(await generateVapidKeys()), subject: 'mailto:push@example.com' };
  const subscription = { ...newReceiver().target, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' };

  expect(await send(subscription, '{}', vapid, { ttl: 60, urgency: 'high', topic: 'rent' })).toEqual(expected);
});
