import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { clearNotifications } from '../src/client/clear.js';
import type { OnScreen } from '../src/tray.js';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// Like iOS: close() does nothing until the notification is 30 seconds old.
function iosTray(tags: string[]) {
  const born = Date.now();
  const open = new Set(tags);
  const listing: OnScreen[] = tags.map((tag) => ({
    title: tag,
    tag,
    data: null,
    close: () => void (Date.now() - born >= 30_000 && open.delete(tag)),
  }));
  return { open, getNotifications: async () => listing.filter((notification) => open.has(notification.tag)) };
}

async function flush(ticks = 5): Promise<void> {
  if (ticks === 0) return;
  await Promise.resolve();
  await flush(ticks - 1);
}

test('clearing tries again once iOS lets young notifications close', async () => {
  const tray = iosTray(['done', 'still-due']);
  clearNotifications(Promise.resolve(tray), (tag) => tag === 'done');
  await flush();
  expect([...tray.open]).toEqual(['done', 'still-due']);

  jest.advanceTimersByTime(31_000);
  await flush();
  expect([...tray.open]).toEqual(['still-due']);
});

test('cancelling clears nothing more once the state it decided on is gone', async () => {
  const tray = iosTray(['done']);
  const cancel = clearNotifications(tray, () => true);
  await flush();
  cancel();
  jest.advanceTimersByTime(31_000);
  await flush();
  expect([...tray.open]).toEqual(['done']);
});

test('cancelling while the notifications are still being listed closes none of them', async () => {
  const listing = Promise.withResolvers<OnScreen[]>();
  let closed = 0;
  const tray = { getNotifications: () => listing.promise };
  const cancel = clearNotifications(tray, () => true);
  await flush();
  cancel();
  listing.resolve([{ title: 'done', tag: 'done', data: null, close: () => void closed++ }]);
  await flush();
  expect(closed).toBe(0);
});
