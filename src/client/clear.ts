import { closeNotifications, type Tray } from '../tray.js';

// iOS ignores close() on a notification younger than 30 seconds (WebKit 309940); one more second covers the clock.
const CLOSABLE_AFTER_MS = 31_000;

/**
 * Closes the notifications whose tag `shouldClear` picks now, and again once iOS lets the young ones close. Call the
 * returned function when the state it decides on changes: nothing more is closed after that, not even by a pass
 * that is still waiting for the registration or the listing.
 */
export function clearNotifications(
  registration: Tray | PromiseLike<Tray>,
  shouldClear: (tag: string) => boolean,
): () => void {
  let active = true;
  const clear = () => {
    if (!active) return;
    void Promise.resolve(registration).then((tray) => closeNotifications(tray, (tag) => active && shouldClear(tag)));
  };
  clear();
  const again = setTimeout(clear, CLOSABLE_AFTER_MS);
  return () => {
    active = false;
    clearTimeout(again);
  };
}
