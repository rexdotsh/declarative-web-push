import { messageProblem } from './validate.js';

/** A browser's push subscription, as `PushSubscription.toJSON()` reports it: what the client sends the server. */
export interface PushSubscriptionKeys {
  endpoint: string;
  /** The subscription's P-256 public key, base64url. */
  p256dh: string;
  /** The subscription's authentication secret, base64url. */
  auth: string;
}

export interface DeclarativeAction {
  action: string;
  title: string;
  navigate: string;
  icon?: string;
}

/** The `notification` of a declarative push message, as the W3C Push API defines it. URLs are absolute. */
export interface DeclarativeNotification<Data = unknown> {
  title: string;
  /** Where a tap goes, without running any script. */
  navigate: string;
  dir?: 'auto' | 'ltr' | 'rtl';
  lang?: string;
  body?: string;
  /** Names the notification for `getNotifications({ tag })` and clearing. iOS keeps it when it drops `data`. */
  tag?: string;
  image?: string;
  icon?: string;
  badge?: string;
  vibrate?: number[];
  timestamp?: number;
  renotify?: boolean;
  silent?: boolean;
  requireInteraction?: boolean;
  data?: Data;
  actions?: DeclarativeAction[];
}

export interface DeclarativeMessage<Notification extends DeclarativeNotification = DeclarativeNotification> {
  web_push: 8030;
  notification: Notification;
  /** Wakes the service worker with the notification before it is shown, so it can confirm or replace it. */
  mutable?: boolean;
  /** The number on the app icon, in digits. WebKit reads it here, beside `notification`. */
  app_badge?: string;
}

export interface MessageOptions {
  /**
   * Whether the service worker hears about the message (the receipt hook). On iOS only a mutable notification can
   * be closed by code later; an immutable one stays until the user clears it.
   */
  mutable: boolean;
  /** Sets the app icon's badge, where the platform supports it. */
  appBadge?: number;
}

/**
 * A declarative push message, checked the way `readPush` checks what arrives, so it never builds what it would
 * drop: required members, their types and ranges, absolute URLs, and what browsers throw on when showing it
 * (`renotify` without a tag, `vibrate` on a silent notification). Throws a TypeError naming the problem.
 */
export function declarativeMessage<Notification extends DeclarativeNotification>(
  notification: Notification,
  { mutable, appBadge }: MessageOptions,
): DeclarativeMessage<Notification> {
  const message: DeclarativeMessage<Notification> = {
    web_push: 8030,
    notification,
    ...(mutable && { mutable }),
    ...(appBadge !== undefined && { app_badge: String(appBadge) }),
  };
  const problem = messageProblem(message);
  if (problem) throw new TypeError(problem);
  return message;
}
