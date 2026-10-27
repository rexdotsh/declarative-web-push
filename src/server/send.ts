import { utf8 } from '../encoding.js';
import type { PushSubscriptionKeys } from '../index.js';
import { encrypt } from './encrypt.js';
import { isPushServiceEndpoint } from './services.js';
import { vapidAuthorization, type Vapid } from './vapid.js';

export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

export interface SendOptions {
  /** Seconds the push service keeps the message for a device that is offline. 0 delivers now or never. */
  ttl: number;
  urgency?: Urgency;
  /** Replaces a message with the same topic still waiting at the push service: up to 32 base64url characters. */
  topic?: string;
}

/**
 * - `sent`: the push service accepted the message, which is not yet a delivery: only a receipt proves that.
 * - `gone`: the subscription expired or was unsubscribed. Delete it.
 * - `retry`: the push service is busy or down, or did not answer (status 0).
 * - `rejected`: the push service refused this request, such as a bad VAPID key or an oversized body.
 */
export type Outcome = 'sent' | 'gone' | 'retry' | 'rejected';

export interface SendResult {
  /** The push service's HTTP status, or 0 when it could not be reached. */
  status: number;
  outcome: Outcome;
  /** The start of the push service's explanation when it did not accept the message. */
  detail: string;
}

const TIMEOUT_MS = 15_000;
const DETAIL_CHARS = 200;

export function pushOutcome(status: number): Outcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 0 || status === 429 || status >= 500) return 'retry';
  return 'rejected';
}

function pushHeaders({ ttl, urgency, topic }: SendOptions): Record<string, string> {
  if (!Number.isSafeInteger(ttl) || ttl < 0) throw new RangeError('ttl is a whole number of seconds');
  if (topic !== undefined && !/^[\w-]{1,32}$/.test(topic))
    throw new RangeError('a topic is 1 to 32 base64url characters');
  return {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    ...(urgency && { Urgency: urgency }),
    ...(topic && { Topic: topic }),
  };
}

async function post(endpoint: string, init: RequestInit): Promise<SendResult> {
  try {
    const response = await fetch(endpoint, init);
    const outcome = pushOutcome(response.status);
    const detail = outcome === 'sent' ? '' : (await response.text()).slice(0, DETAIL_CHARS);
    return { status: response.status, outcome, detail };
  } catch (error) {
    return { status: 0, outcome: 'retry', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Encrypts and sends one message. Throws only for mistakes in the call: an unknown push service, a bad option, an oversized payload. */
export async function send(
  subscription: PushSubscriptionKeys,
  payload: string | Uint8Array,
  vapid: Vapid,
  options: SendOptions,
): Promise<SendResult> {
  if (!isPushServiceEndpoint(subscription.endpoint))
    throw new TypeError('refusing to push to a non push service endpoint');
  const headers = pushHeaders(options);
  const [body, authorization] = await Promise.all([
    encrypt(typeof payload === 'string' ? utf8(payload) : payload, subscription),
    vapidAuthorization(subscription.endpoint, vapid),
  ]);
  return post(subscription.endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { ...headers, Authorization: authorization },
    body,
  });
}
