import { fromBase64url, toBase64url } from '../encoding.js';
import type { PushSubscriptionKeys } from '../index.js';

interface Subscription {
  readonly options: { readonly applicationServerKey: ArrayBuffer | null };
  unsubscribe(): Promise<boolean>;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
}

export interface Subscriber {
  readonly pushManager: {
    subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<Subscription>;
  };
}

function keysOf(subscription: Subscription): PushSubscriptionKeys {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('push subscription is missing keys');
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/**
 * Subscribes with the server's VAPID public key, keeping `current` when it was made with that key and replacing it
 * when the key changed, since a push service rejects messages signed by another key. Send the result to the server.
 * Pass `getSubscription()`, or the event's `newSubscription` in `pushsubscriptionchange`.
 */
export async function subscribe(
  registration: Subscriber,
  applicationServerKey: string,
  current: Subscription | null,
): Promise<PushSubscriptionKeys> {
  const key = fromBase64url(applicationServerKey);
  let subscription = current;
  const subscribedWith = subscription?.options.applicationServerKey;
  if (subscription && !(subscribedWith && toBase64url(new Uint8Array(subscribedWith)) === toBase64url(key))) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return keysOf(subscription);
}
