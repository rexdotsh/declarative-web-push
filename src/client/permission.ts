/** `unsupported` includes iOS Safari outside a Home Screen web app, which has no Push API at all. */
export type PushPermission = 'unsupported' | 'prompt' | 'denied' | 'granted';

export function pushPermission(): PushPermission {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'default') return 'prompt';
  return Notification.permission;
}

/** Asks for notification permission. iOS only asks during a tap, so call this from one. */
export async function requestPushPermission(): Promise<PushPermission> {
  if (pushPermission() === 'unsupported') return 'unsupported';
  await Notification.requestPermission();
  return pushPermission();
}
