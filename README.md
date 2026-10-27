# declarative-web-push

Web Push for PWAs that actually works on iOS: declarative payloads, delivery receipts, clearing notifications, zero dependencies, runs on Cloudflare Workers.

Every message is a [declarative push message](https://w3c.github.io/push-api/#declarative-push-message). Safari shows it even if the service worker is gone, and wakes the worker first when it is `mutable`; other browsers hand the same JSON to the worker, which shows it. Either way the worker gets one typed value, so it can post a receipt, and pages and workers can clear what is no longer relevant, within the rules iOS actually enforces (see [iOS behaviour](#ios-behaviour)).

```sh
bun add declarative-web-push   # or npm install declarative-web-push
```

| Import                        | Runs in                                  | For                                                    |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `declarative-web-push`        | anywhere                                 | the message format: `declarativeMessage` and its types |
| `declarative-web-push/server` | Workers, Node 22.1+, Bun, Deno, browsers | VAPID, RFC 8291 encryption, `send`                     |
| `declarative-web-push/worker` | the service worker                       | reading pushes, showing, closing, receipt deadlines    |
| `declarative-web-push/client` | the page                                 | subscribing, permission, clearing notifications        |

Everything is ESM with types, uses only WebCrypto, `fetch` and the Notifications API, and has no dependencies.

## Server

```ts
import { declarativeMessage } from 'declarative-web-push';
import { generateVapidKeys, send, vapidKeys } from 'declarative-web-push/server';

// Once: keep the result as a secret. Its public half is vapidKeys(secret).publicKey.
const secret = await generateVapidKeys();

const message = declarativeMessage(
  {
    title: 'Pay rent',
    body: 'Due 9:00',
    navigate: 'https://app.example/?open=rent',
    tag: 'rent:2026-11-01',
    data: { id: 'rent', fire: 'rent@1793116800000' },
  },
  { mutable: true, appBadge: 1 },
);

const result = await send(
  subscription,
  JSON.stringify(message),
  { keys: vapidKeys(env.VAPID_JWK), subject: 'https://app.example' },
  {
    ttl: 24 * 3600,
    urgency: 'high',
    topic: 'rent',
  },
);
if (result.outcome === 'gone') await forget(subscription);
```

- `declarativeMessage` refuses what browsers would drop or throw on: an empty title, relative URLs, `renotify` without a tag, a silent notification that vibrates. It puts `mutable` and `app_badge` at the top level, where WebKit reads them.
- `send` encrypts (one aes128gcm record, up to `MAX_PAYLOAD_BYTES`), signs a VAPID JWT (cached for 12 hours per push service), and only ever contacts the known push services: `isPushServiceEndpoint` is the same check, for validating subscriptions when they arrive.
- It resolves to `{ status, outcome, detail }`. `outcome` is `sent`, `gone` (delete the subscription), `retry` (429, 5xx, or no answer: `status` 0) or `rejected`. It throws only for a mistake in the call. `pushOutcome(status)` classifies a stored status the same way.
- `sent` only means the push service took it. Only a receipt from the device means it arrived.
- `canReplace(endpoint)` says whether a resend with the same tag replaces the notification on screen. It does not on Apple's push service, so a resend there shows a second notification.
- `vapidKeys` imports each key once, so calling it per request (as on Workers, where secrets live on `env`) is cheap.

## Service worker

```ts
import { readPush, showUnlessOnScreen, waitUntilWithin } from 'declarative-web-push/worker';

const isData = (data: unknown): data is { id: string; fire: string } => /* validate */;

self.addEventListener('push', (event) => {
  const push = readPush(event, isData);
  if (!push) return;
  if (push.kind === 'declarative') {
    // Safari made the notification and shows it once this event settles: give the receipt 3 s at most.
    waitUntilWithin(event, receipt(push.data.fire), 3000);
    return;
  }
  const { notification } = push.message;
  event.waitUntil(
    Promise.all([
      showUnlessOnScreen(self.registration, notification, {
        isShowing: (shown) => isData(shown.data) && shown.data.fire === notification.data.fire,
        options: { data: { ...notification.data, navigate: notification.navigate }, icon: '/icon-192.png' },
      }),
      receipt(notification.data.fire),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.navigate));
});
```

- `readPush` returns `declarative` (Safari: `event.data` is null and the notification it built carries your `data`) or `imperative` (any other browser: the message to show), with `data` checked by your guard, or `null` when the push is not one of yours.
- `showUnlessOnScreen` skips a message that `isShowing` finds among the notifications with the tag it would be shown with, so a resend does not alert twice. Calls in the same context take turns per tag, so two at once still show it once. The page and the service worker are separate contexts: if both can show the same message, keeping them from doing so at the same moment is yours to do (a claim in IndexedDB, say). It leaves `navigate` out: a browser that honours it navigates on a tap instead of firing `notificationclick`. `options` can add it back and add what a declarative message cannot carry, such as action buttons.
- `closeNotifications(registration, (tag) => …)` closes the notifications whose tag you pick. On iOS that is the only way to recognise them, since `getNotifications()` drops a declarative notification's `data`.
- `waitUntilWithin` bounds extra work. iOS holds a declarative notification until the push event settles, so an unbounded sync or receipt would delay it.

## Page

```ts
import { clearNotifications, pushPermission, requestPushPermission, subscribe } from 'declarative-web-push/client';

if (pushPermission() === 'prompt' && (await requestPushPermission()) === 'granted') {
  const registration = await navigator.serviceWorker.ready;
  const keys = await subscribe(registration, vapidPublicKey, await registration.pushManager.getSubscription());
  await fetch('/api/subscribe', { method: 'POST', body: JSON.stringify(keys) });
}

// When the app opens, or its state changes: closes what is done now, and again once iOS allows.
const cancel = clearNotifications(navigator.serviceWorker.ready, (tag) => isDone(tag));
```

- `pushPermission()` is `unsupported`, `prompt`, `denied` or `granted`. iOS has no Push API outside a Home Screen web app, so Safari in a tab is `unsupported`. iOS only asks for permission during a tap.
- `subscribe` keeps the current subscription when it was made with the same key, and replaces it when the server's key changed. In `pushsubscriptionchange`, pass `event.newSubscription`.
- `clearNotifications` closes now and again after 31 s, because iOS ignores `close()` on younger notifications. Call `cancel` when the state it decided on changes.

## iOS behaviour

Measured on an iPhone with Safari 27.0.1, through Apple's push service ([findings](docs/findings/2026-10-27-ios.md)):

| Behaviour                        | Declarative, mutable                                                       | Declarative, immutable   | Shown by the service worker |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------ | --------------------------- |
| Shown without the service worker | yes                                                                        | yes                      | no                          |
| Fires `push`                     | yes, `event.data` null, `event.notification` set, about 1 s after the send | no                       | yes, with `event.data`      |
| `data` in `getNotifications()`   | `null` (the tag is kept)                                                   | `null` (the tag is kept) | kept                        |
| `close()` from page or worker    | works after 30 s                                                           | never                    | works after 30 s            |

- The same tag never replaced a notification on screen, declarative or shown by the worker (WebKit [258922](https://bugs.webkit.org/show_bug.cgi?id=258922), still open as [319860](https://bugs.webkit.org/show_bug.cgi?id=319860)), so a resend through Apple's push service shows twice.
- Swiping a notification away fires no `notificationclose`; it just stops being listed.
- The 30 s rule is WebKit's guard against "silent push" abuse ([309940](https://bugs.webkit.org/show_bug.cgi?id=309940)), and `close()` fails silently before then: only listing again tells.
- WebKit's declarative parser reads `app_badge` and `mutable` beside `notification` (not inside it), and of the notification only `title`, `navigate`, `dir`, `lang`, `body`, `tag`, `icon`, `silent` and `data`.

So on iOS: send mutable messages, identify notifications by their tag, clear them from the page as well as the worker, expect a resend to show twice, and keep the push handler short.

## License

MIT
