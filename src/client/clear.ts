import { closeNotifications, type Tray } from '../tray.js';

// iOS ignores close() on a notification younger than 30 seconds (WebKit 309940); one more second covers the clock.
const CLOSABLE_AFTER_MS = 31_000;

/**
 * Closes the notifications whose tag `shouldClear` picks now, and again once iOS lets the young ones close. Call the
 * returned function when the state it decides on changes, to cancel the second pass.
 */
export function clearNotifications(
  registration: Tray | PromiseLike<Tray>,
  shouldClear: (tag: string) => boolean,
): () => void {
  const clear = () => void Promise.resolve(registration).then((tray) => closeNotifications(tray, shouldClear));
  clear();
  const again = setTimeout(clear, CLOSABLE_AFTER_MS);
  return () => clearTimeout(again);
}
