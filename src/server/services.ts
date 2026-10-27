const PUSH_SERVICES = [
  // Apple shows every push as a new notification whatever its tag (WebKit bugs 258922 and 319860).
  { host: /(^|\.)push\.apple\.com$/, canReplace: false },
  { host: /^fcm\.googleapis\.com$/, canReplace: true },
  { host: /\.notify\.windows\.com$/, canReplace: true },
  { host: /(^|\.)push\.services\.mozilla\.com$/, canReplace: true },
];

function pushService(endpoint: string) {
  const url = URL.parse(endpoint);
  if (url?.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return undefined;
  return PUSH_SERVICES.find(({ host }) => host.test(url.hostname));
}

/** Whether an endpoint belongs to a known push service. Subscriptions come from clients, so anything else is refused. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  return pushService(endpoint) !== undefined;
}

/** Whether a resend with the same tag replaces the notification on screen instead of adding a second one. */
export function canReplace(endpoint: string): boolean {
  return pushService(endpoint)?.canReplace ?? false;
}
