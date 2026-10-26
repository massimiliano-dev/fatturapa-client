import { isIP } from 'node:net';
import {
  parseJsonBody,
  verifyStaticSecret,
  WebhookAuthenticationError,
} from '@massimiliano-dev/fatturapa-core';
import { callbackCreateInvoice, callbackCreateNotification, callbackUpdateInvoiceStatus } from './schemas.js';

/** Source IPs of Aruba callbacks (docs §14). */
export const ARUBA_CALLBACK_IPS = [
  '46.37.19.5',
  '46.37.19.6',
  '62.149.180.5',
  '62.149.180.6',
  '217.61.9.4',
] as const;

export type ArubaCallback =
  | { kind: 'createInvoice'; data: ReturnType<typeof callbackCreateInvoice.parse> }
  | { kind: 'createNotification'; data: ReturnType<typeof callbackCreateNotification.parse> }
  | { kind: 'updateInvoiceStatus'; data: ReturnType<typeof callbackUpdateInvoiceStatus.parse> };

/**
 * Verifies an Aruba callback (Premium accounts, docs §14): the static API key in `Authorization`, chosen at
 * accreditation, and optionally the source IP against Aruba's published list. Aruba does not sign the body,
 * so use a long random key, check the IP (pass the real client IP, not a proxy's), and re-read the invoice
 * through the API before acting on status changes.
 *
 * @param kind which of your endpoints received the call (each method has its own URL).
 * @throws {WebhookAuthenticationError} if the request is not authentic or the payload is malformed.
 */
export function verifyArubaCallback(
  kind: ArubaCallback['kind'],
  request: {
    headers: Record<string, string | string[] | undefined>;
    body: string | Uint8Array;
    remoteAddress?: string;
  },
  options: { apiKey: string; checkSourceIp?: boolean; allowedIps?: readonly string[]; maxBytes?: number },
): ArubaCallback {
  verifyStaticSecret(request.headers, { expected: options.apiKey, provider: 'aruba' });
  if (options.checkSourceIp !== false) {
    const ip = (request.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!isIP(ip) || !(options.allowedIps ?? ARUBA_CALLBACK_IPS).includes(ip)) {
      throw new WebhookAuthenticationError('aruba: callback from an unexpected source address');
    }
  }
  const body = parseJsonBody(request.body, options.maxBytes ?? 40 * 1024 * 1024, 'aruba');
  const schema = {
    createInvoice: callbackCreateInvoice,
    createNotification: callbackCreateNotification,
    updateInvoiceStatus: callbackUpdateInvoiceStatus,
  }[kind];
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new WebhookAuthenticationError(`aruba: malformed ${kind} callback`);
  return { kind, data: parsed.data } as ArubaCallback;
}
