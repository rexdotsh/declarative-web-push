import { expect, test } from 'bun:test';
import { declarativeMessage, type DeclarativeNotification, type MessageOptions } from '../src/index.js';

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

const unbuildable: [string, DeclarativeNotification, Partial<MessageOptions>][] = [
  ['an empty title', { ...valid, title: '' }, {}],
  ['a relative navigate', { ...valid, navigate: '/?open=1' }, {}],
  ['a relative icon', { ...valid, icon: '/icon.png' }, {}],
  ['an action with a relative navigate', { ...valid, actions: [{ action: 'a', title: 'A', navigate: '/a' }] }, {}],
  ['renotify without a tag', { ...valid, tag: undefined, renotify: true }, {}],
  ['vibrate on a silent notification', { ...valid, silent: true, vibrate: [100] }, {}],
  ['a fractional badge', valid, { appBadge: 1.5 }],
  ['a negative badge', valid, { appBadge: -1 }],
];

test.each(unbuildable)('refuses to build a message with %s', (_, notification, options) => {
  expect(() => declarativeMessage(notification, { mutable: true, ...options })).toThrow();
});
