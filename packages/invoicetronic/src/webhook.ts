import {
  bodyBytes,
  constantTimeEqual,
  hmacSha256Hex,
  singleHeader,
  WebhookAuthenticationError,
} from '@massimiliano-dev/fatturapa-core';
import { z } from 'zod';

/** A verified Invoicetronic event. It carries ids only: read the resource through the API. */
export interface InvoicetronicWebhookEvent {
  id: number;
  companyId?: number;
  resourceId?: number;
  /** `send`, `receive`, `update`, `company`. */
  endpoint: string;
  method: string;
  success?: boolean;
  dateTime?: string;
  /** 1 for the first delivery. Delivery is at least once: deduplicate on `id`. */
  attempt?: number;
}

const payload = z.object({
  id: z.number().int(),
  user_id: z.number().int().nullish(),
  company_id: z.number().int().nullish(),
  resource_id: z.number().int().nullish(),
  endpoint: z.string().max(50),
  method: z.string().max(10),
  status_code: z.number().int().nullish(),
  success: z.boolean().nullish(),
  date_time: z.string().max(50).nullish(),
  api_version: z.union([z.string().max(20), z.number()]).nullish(),
});

/**
 * Verifies an Invoicetronic webhook (invoicetronic.com/en/docs/webhooks): header
 * `Invoicetronic-Signature: t=<unix>,v1=<hex>`, where v1 = HMAC-SHA256(secret, `${t}.${raw body}`).
 * The comparison is constant-time and the timestamp must be within `toleranceSeconds` (default 300, as
 * recommended). Pass the raw body exactly as received.
 *
 * @throws {WebhookAuthenticationError} if the request is not authentic.
 */
export function verifyInvoicetronicWebhook(
  request: { headers: Record<string, string | string[] | undefined>; body: string | Uint8Array },
  options: { secret: string; toleranceSeconds?: number; now?: Date; maxBytes?: number },
): InvoicetronicWebhookEvent {
  if (options.secret.length < 16) throw new RangeError('secret looks too short');
  const header = singleHeader(request.headers, 'invoicetronic-signature');
  if (!header || header.length > 2048)
    throw new WebhookAuthenticationError('invoicetronic: request is not signed');
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string | undefined]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k, v]) => k === 'v1' && v !== undefined).map(([, v]) => v!);
  if (!t || !/^\d{1,12}$/.test(t) || signatures.length === 0)
    throw new WebhookAuthenticationError('invoicetronic: malformed signature header');
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(t)) > (options.toleranceSeconds ?? 300))
    throw new WebhookAuthenticationError('invoicetronic: signature timestamp out of tolerance');
  const body = bodyBytes(request.body);
  if (body.byteLength > (options.maxBytes ?? 1024 * 1024))
    throw new WebhookAuthenticationError('invoicetronic: body too large');
  const expected = hmacSha256Hex(options.secret, Buffer.concat([Buffer.from(`${t}.`), body]));
  if (!signatures.some((s) => constantTimeEqual(s.toLowerCase(), expected)))
    throw new WebhookAuthenticationError('invoicetronic: signature is invalid');

  let parsed: z.infer<typeof payload>;
  try {
    parsed = payload.parse(JSON.parse(body.toString('utf8')));
  } catch {
    throw new WebhookAuthenticationError('invoicetronic: unexpected webhook payload');
  }
  const attempt = Number(singleHeader(request.headers, 'invoicetronic-delivery-attempt'));
  return {
    id: parsed.id,
    endpoint: parsed.endpoint,
    method: parsed.method,
    ...(parsed.company_id ? { companyId: parsed.company_id } : {}),
    ...(parsed.resource_id ? { resourceId: parsed.resource_id } : {}),
    ...(typeof parsed.success === 'boolean' ? { success: parsed.success } : {}),
    ...(parsed.date_time ? { dateTime: parsed.date_time } : {}),
    ...(Number.isSafeInteger(attempt) && attempt > 0 ? { attempt } : {}),
  };
}
