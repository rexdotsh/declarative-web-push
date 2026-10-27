import { expect, jest, test } from 'bun:test';
import { declarativeMessage } from '../src/index.js';
import type { OnScreen } from '../src/tray.js';
import { readPush, showUnlessOnScreen, waitUntilWithin, type ShowOptions } from '../src/worker/index.js';

const notification = { title: 'Pay rent', navigate: 'https://app.example/?open=1', tag: 'rent', data: { id: 'rent' } };
const message = declarativeMessage(notification, { mutable: true, appBadge: 2 });
const isData = (data: unknown): data is { id: string } =>
  typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string';

function onScreen(tag: string, data: unknown): OnScreen {
  return { title: 'x', tag, data, close: () => undefined };
}

const payload = (value: unknown) => ({ json: () => value });
const garbage = {
  json: () => {
    throw new SyntaxError('not JSON');
  },
};
const proposed = onScreen('rent', { id: 'rent' });

test.each([
  [
    "Safari's declarative push",
    { data: null, notification: proposed },
    { kind: 'declarative', notification: proposed, data: { id: 'rent' } },
  ],
  ['a declarative push with foreign data', { data: null, notification: onScreen('rent', { id: 1 }) }, null],
  ['a declarative message the browser left to the worker', { data: payload(message) }, { kind: 'imperative', message }],
  ['a message from another sender', { data: payload({ title: 'hi' }) }, null],
  ['a push without a payload', { data: null }, null],
  ['a payload that is not JSON', { data: garbage }, null],
  [
    'a message whose data fails the check',
    { data: payload({ ...message, notification: { ...notification, data: 7 } }) },
    null,
  ],
  ['another web_push version', { data: payload({ ...message, web_push: 8031 }) }, null],
  [
    'a notification without navigate',
    { data: payload({ ...message, notification: { ...notification, navigate: undefined } }) },
    null,
  ],
  [
    'a mistyped optional member',
    { data: payload({ ...message, notification: { ...notification, renotify: 'yes' } }) },
    null,
  ],
  ['a badge that is not digits', { data: payload({ ...message, app_badge: '-1' }) }, null],
] as const)('reads %s', (_, event, expected) => {
  expect(readPush(event, isData)).toEqual(expected);
});

function registration(showing: OnScreen[]) {
  const shown: { title: string; options: ShowOptions }[] = [];
  return {
    shown,
    getNotifications: async (filter?: { tag?: string }) => showing.filter((n) => !filter?.tag || n.tag === filter.tag),
    showNotification: async (title: string, options: ShowOptions) => void shown.push({ title, options }),
  };
}

const isShowing = (fire: number) => (n: OnScreen) =>
  typeof n.data === 'object' && n.data !== null && 'fire' in n.data && n.data.fire === fire;

test('a resend already on screen is not shown, and alerts, a second time', async () => {
  const tray = registration([onScreen('rent', { id: 'rent', fire: 1 })]);

  expect(await showUnlessOnScreen(tray, notification, { isShowing: isShowing(1) })).toBe(false);
  expect(await showUnlessOnScreen(tray, notification, { isShowing: isShowing(2), options: { icon: '/i.png' } })).toBe(
    true,
  );
  expect(tray.shown).toEqual([{ title: 'Pay rent', options: { tag: 'rent', data: { id: 'rent' }, icon: '/i.png' } }]);
});

test('the receipt deadline lets the push event settle while the work is still running', async () => {
  jest.useFakeTimers();
  let settled = false;
  waitUntilWithin({ waitUntil: (work) => void work.then(() => (settled = true)) }, new Promise(() => undefined), 3000);
  jest.advanceTimersByTime(2999);
  await Promise.resolve();
  expect(settled).toBe(false);
  jest.advanceTimersByTime(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(true);
  jest.useRealTimers();
});
