import { expect, test } from 'bun:test';
import { declarativeMessage } from '../src/index.js';
import { readPush } from '../src/worker/index.js';

const valid = { title: 'Pay rent', navigate: 'https://app.example/?open=1', tag: 'rent', data: { id: 'rent' } };

test('a declarative message carries the badge and mutable flag where WebKit reads them, beside the notification', () => {
  expect(declarativeMessage(valid, { mutable: true, appBadge: 3 })).toEqual({
    web_push: 8030,
    mutable: true,
    app_badge: '3',
    notification: valid,
  });
  expect(declarativeMessage(valid, { mutable: false })).toEqual({ web_push: 8030, notification: valid });
});

const anyData = (data: unknown): data is unknown => data !== null;
const all = {
  ...valid,
  dir: 'rtl',
  lang: 'en',
  body: 'Due 9:00',
  image: 'https://app.example/i.png',
  icon: 'https://app.example/icon.png',
  badge: 'https://app.example/badge.png',
  vibrate: [0, 2 ** 32 - 1],
  timestamp: Number.MAX_SAFE_INTEGER,
  renotify: true,
  silent: false,
  requireInteraction: true,
  actions: [{ action: 'done', title: 'Done', navigate: 'https://app.example/done', icon: 'https://app.example/d.png' }],
};

// A list of the given length with nothing in it, as `new Array(n)` makes.
function holes<T>(length: number): T[] {
  const list: T[] = [];
  list.length = length;
  return list;
}

const cases: [string, Record<string, unknown>, number | undefined, boolean][] = [
  ['the required members', valid, undefined, true],
  ['every member', all, 7, true],
  ['no title', { ...valid, title: undefined }, undefined, false],
  ['an empty title', { ...valid, title: '' }, undefined, false],
  ['no navigate', { ...valid, navigate: undefined }, undefined, false],
  ['a relative navigate', { ...valid, navigate: '/?open=1' }, undefined, false],
  ['a relative icon', { ...valid, icon: '/icon.png' }, undefined, false],
  ['a bad dir', { ...valid, dir: 'up' }, undefined, false],
  ['a mistyped boolean', { ...valid, renotify: 'yes' }, undefined, false],
  ['a negative timestamp', { ...valid, timestamp: -1 }, undefined, false],
  ['a fractional timestamp', { ...valid, timestamp: 1.5 }, undefined, false],
  ['a timestamp past 2^53', { ...valid, timestamp: 2 ** 53 }, undefined, false],
  ['a negative vibration', { ...valid, vibrate: [-1] }, undefined, false],
  ['a vibration past 32 bits', { ...valid, vibrate: [2 ** 32] }, undefined, false],
  ['vibrate that is not a list', { ...valid, vibrate: 100 }, undefined, false],
  ['renotify without a tag', { ...valid, tag: undefined, renotify: true }, undefined, false],
  ['vibrate on a silent notification', { ...valid, silent: true, vibrate: [100] }, undefined, false],
  [
    'an action without a title',
    { ...valid, actions: [{ action: 'a', navigate: 'https://a.example' }] },
    undefined,
    false,
  ],
  [
    'an action with a relative navigate',
    { ...valid, actions: [{ action: 'a', title: 'A', navigate: '/a' }] },
    undefined,
    false,
  ],
  ['a vibration list with a hole', { ...valid, vibrate: holes<number>(1) }, undefined, false],
  ['a vibration list with undefined', { ...valid, vibrate: [100, undefined] }, undefined, false],
  ['an action list with a hole', { ...valid, actions: holes<object>(1) }, undefined, false],
  ['a negative badge', valid, -1, false],
  ['a fractional badge', valid, 1.5, false],
  ['a badge past 2^53', valid, 2 ** 53, false],
];

// The builder and the reader share one validator: what the builder makes survives JSON and reads back the same, and
// what it refuses, the reader refuses too.
test.each(cases)('builds, sends and reads a notification with %s: %p', (_, notification, appBadge, accepted) => {
  let built: unknown;
  try {
    // @ts-expect-error JavaScript callers can pass anything.
    built = declarativeMessage(notification, { mutable: true, appBadge });
  } catch (error) {
    built = error;
  }
  const refused = {
    web_push: 8030,
    mutable: true,
    notification,
    app_badge: appBadge === undefined ? undefined : String(appBadge),
  };
  const wire = JSON.stringify(built instanceof TypeError ? refused : built);
  const read = readPush({ data: { json: () => JSON.parse(wire) } }, anyData);

  expect(built instanceof TypeError).toBe(!accepted);
  expect(read).toEqual(accepted ? { kind: 'imperative', message: JSON.parse(wire) } : null);
});
