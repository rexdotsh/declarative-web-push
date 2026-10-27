/** A notification on screen, as `getNotifications()` lists it. iOS reports `data` as null for declarative ones. */
export interface OnScreen {
  readonly title: string;
  readonly tag: string;
  readonly data: unknown;
  close(): void;
}

export interface Tray {
  getNotifications(filter?: { tag?: string }): Promise<readonly OnScreen[]>;
}

/**
 * Closes the notifications whose tag `shouldClose` picks. It is asked only once they are listed, so it decides on the
 * latest state. iOS ignores close() for a notification's first 30 seconds, and always for a declarative one that was
 * not mutable, so a young notification can survive this: clear again later (see `clearNotifications` in `/client`).
 */
export async function closeNotifications(tray: Tray, shouldClose: (tag: string) => boolean): Promise<void> {
  for (const notification of await tray.getNotifications()) {
    if (shouldClose(notification.tag)) notification.close();
  }
}
