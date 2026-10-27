import type { DeclarativeAction, DeclarativeMessage, DeclarativeNotification } from '../index.js';
import { isRecord, isUnsigned } from '../guards.js';
import type { OnScreen, Tray } from '../tray.js';

export { closeNotifications, type OnScreen, type Tray } from '../tray.js';

const isString = (value: unknown) => typeof value === 'string';
const isBoolean = (value: unknown) => typeof value === 'boolean';

function isAction(value: unknown): value is DeclarativeAction {
  return (
    isRecord(value) &&
    [value.action, value.title, value.navigate].every(isString) &&
    (value.icon === undefined || isString(value.icon))
  );
}

const OPTIONAL: Record<
  Exclude<keyof DeclarativeNotification, 'title' | 'navigate' | 'data'>,
  (value: unknown) => boolean
> = {
  dir: (value) => value === 'auto' || value === 'ltr' || value === 'rtl',
  lang: isString,
  body: isString,
  tag: isString,
  image: isString,
  icon: isString,
  badge: isString,
  vibrate: (value) => Array.isArray(value) && value.every(isUnsigned),
  timestamp: isUnsigned,
  renotify: isBoolean,
  silent: isBoolean,
  requireInteraction: isBoolean,
  actions: (value) => Array.isArray(value) && value.every(isAction),
};

/** Whether a decoded push payload is a declarative message whose `data` passes `isData`. */
export function isDeclarativeMessage<Data>(
  value: unknown,
  isData: (data: unknown) => data is Data,
): value is DeclarativeMessage<DeclarativeNotification<Data> & { data: Data }> {
  if (!isRecord(value) || value.web_push !== 8030 || !isRecord(value.notification)) return false;
  const { notification } = value;
  return (
    isString(notification.title) &&
    isString(notification.navigate) &&
    isData(notification.data) &&
    Object.entries(OPTIONAL).every(([key, valid]) => notification[key] === undefined || valid(notification[key])) &&
    (value.mutable === undefined || isBoolean(value.mutable)) &&
    (value.app_badge === undefined || (isString(value.app_badge) && /^\d+$/.test(value.app_badge)))
  );
}

/** The parts of a `PushEvent` this reads; `notification` is Safari's, for declarative messages. */
export interface PushEventLike {
  readonly data: { json(): unknown } | null;
  readonly notification?: OnScreen | null;
}

/**
 * - `declarative`: the browser built the notification itself (Safari) and shows it once the push event settles.
 *   `event.data` is null; the notification's `data` is intact here, unlike in `getNotifications()` later.
 * - `imperative`: the browser does not understand declarative messages, so the service worker has to show it.
 */
export type IncomingPush<Data> =
  | { kind: 'declarative'; notification: OnScreen; data: Data }
  | { kind: 'imperative'; message: DeclarativeMessage<DeclarativeNotification<Data> & { data: Data }> };

/** Reads a push event either way it can arrive, or null when it is not a declarative message with valid `data`. */
export function readPush<Data>(
  event: PushEventLike,
  isData: (data: unknown) => data is Data,
): IncomingPush<Data> | null {
  const proposed = event.notification;
  if (proposed) {
    const data = proposed.data;
    return isData(data) ? { kind: 'declarative', notification: proposed, data } : null;
  }
  if (!event.data) return null;
  let message: unknown;
  try {
    message = event.data.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return isDeclarativeMessage(message, isData) ? { kind: 'imperative', message } : null;
}

/** `NotificationOptions` with the members only some browsers type or support. */
export interface ShowOptions {
  body?: string;
  tag?: string;
  icon?: string;
  image?: string;
  badge?: string;
  dir?: 'auto' | 'ltr' | 'rtl';
  lang?: string;
  vibrate?: number[];
  timestamp?: number;
  renotify?: boolean;
  silent?: boolean;
  requireInteraction?: boolean;
  data?: unknown;
  actions?: { action: string; title: string; icon?: string }[];
  /** Where Safari navigates on a tap instead of firing `notificationclick`. */
  navigate?: string;
}

export interface Shower extends Tray {
  showNotification(title: string, options: ShowOptions): Promise<void>;
}

/**
 * Shows a message the browser did not show itself, unless `isShowing` recognises it among the notifications with
 * its tag: a resend of a message already on screen must not alert again.
 *
 * `navigate` is left out, since a browser that honours it navigates on a tap instead of firing `notificationclick`
 * (WHATWG Notifications, "activating a notification"); `options` can add it back, and overrides any other member.
 */
export async function showUnlessOnScreen<Data>(
  registration: Shower,
  notification: DeclarativeNotification<Data>,
  { isShowing, options }: { isShowing: (shown: OnScreen) => boolean; options?: ShowOptions },
): Promise<boolean> {
  const current = await registration.getNotifications({ tag: notification.tag });
  if (current.some(isShowing)) return false;
  const { title, navigate: _navigate, actions, ...rest } = notification;
  const buttons = actions?.map(({ action, title: label, icon }) => ({ action, title: label, icon }));
  await registration.showNotification(title, { ...rest, actions: buttons, ...options });
  return true;
}

/**
 * Holds the service worker for `work`, but no longer than `ms`: iOS shows a declarative notification only once its
 * push event settles, so anything slow here (a receipt, a sync) would hold the notification back.
 */
export function waitUntilWithin(
  event: { waitUntil(work: Promise<unknown>): void },
  work: Promise<unknown>,
  ms: number,
): void {
  event.waitUntil(Promise.race([work, new Promise((resolve) => setTimeout(resolve, ms))]));
}
