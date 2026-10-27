import { isRecord } from './guards.js';
import type { DeclarativeMessage, DeclarativeNotification } from './index.js';

const UINT32_MAX = 2 ** 32 - 1;

const isString = (value: unknown) => typeof value === 'string';
const isBoolean = (value: unknown) => typeof value === 'boolean';
const isUnsigned = (max: number) => (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;

// URL.canParse is missing from Safari before 17, and pages build messages too.
function isAbsoluteUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

function isAction(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.action) &&
    isString(value.title) &&
    isAbsoluteUrl(value.navigate) &&
    (value.icon === undefined || isAbsoluteUrl(value.icon))
  );
}

// The W3C declarative push message members, with the types its parser accepts. URLs must be absolute because the
// message is parsed without a page to resolve them against.
const MEMBERS: { [Key in Exclude<keyof DeclarativeNotification, 'data'>]-?: (value: unknown) => boolean } = {
  title: (value) => isString(value) && value !== '',
  navigate: isAbsoluteUrl,
  dir: (value) => value === 'auto' || value === 'ltr' || value === 'rtl',
  lang: isString,
  body: isString,
  tag: isString,
  image: isAbsoluteUrl,
  icon: isAbsoluteUrl,
  badge: isAbsoluteUrl,
  vibrate: (value) => Array.isArray(value) && value.every(isUnsigned(UINT32_MAX)),
  timestamp: isUnsigned(Number.MAX_SAFE_INTEGER),
  renotify: isBoolean,
  silent: isBoolean,
  requireInteraction: isBoolean,
  actions: (value) => Array.isArray(value) && value.every(isAction),
};

const REQUIRED = new Set(['title', 'navigate']);

// What showNotification() throws on (WHATWG Notifications, "create a notification").
const RULES: [string, (notification: Record<string, unknown>) => boolean][] = [
  ['renotify needs a tag', ({ renotify, tag }) => renotify !== true || (isString(tag) && tag !== '')],
  ['a silent notification cannot vibrate', ({ silent, vibrate }) => silent !== true || vibrate === undefined],
];

/** Why a value is not a declarative push message this library would build, or undefined when it is one. */
export function messageProblem(value: unknown): string | undefined {
  if (!isRecord(value) || value.web_push !== 8030) return 'web_push must be 8030';
  const { notification } = value;
  if (!isRecord(notification)) return 'notification must be an object';
  for (const [key, valid] of Object.entries(MEMBERS)) {
    const member = notification[key];
    if (member === undefined ? REQUIRED.has(key) : !valid(member)) return `notification.${key} is missing or invalid`;
  }
  const broken = RULES.find(([, holds]) => !holds(notification));
  if (broken) return broken[0];
  if (value.mutable !== undefined && !isBoolean(value.mutable)) return 'mutable must be a boolean';
  const badge = value.app_badge;
  if (badge !== undefined && !(isString(badge) && /^\d+$/.test(badge) && Number(badge) <= Number.MAX_SAFE_INTEGER)) {
    return 'app_badge must be a whole number';
  }
  return undefined;
}

export function isMessage(value: unknown): value is DeclarativeMessage {
  return messageProblem(value) === undefined;
}
