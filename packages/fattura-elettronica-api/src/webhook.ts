import {
  parseJsonBody,
  verifyStaticSecret,
  WebhookAuthenticationError,
} from '@massimiliano-dev/fatturapa-core';
import { webhookPayload, type FeaFattura } from './schemas.js';

/**
 * Verifies a Fattura Elettronica API webhook (format v2): `Authorization: Bearer <token>` where the token
 * is the value you set in the management panel (not the API token). It is a static secret: it
 * authenticates the caller but does not sign the body, so re-read the invoice with `getFattura(id)` before
 * acting, and use a long random token (at least 32 characters).
 *
 * @throws {WebhookAuthenticationError} if the token is wrong or the payload is not a v2 event.
 */
export function verifyFatturaElettronicaApiWebhook(
  request: { headers: Record<string, string | string[] | undefined>; body: string | Uint8Array },
  options: { token: string; maxBytes?: number },
): { event: 'fattura-ricezione' | 'fattura-aggiornamento'; fattura: FeaFattura } {
  if (options.token.length < 32) throw new RangeError('token must be at least 32 characters');
  verifyStaticSecret(request.headers, {
    expected: `Bearer ${options.token}`,
    provider: 'fattura-elettronica-api',
  });
  const parsed = webhookPayload.safeParse(
    parseJsonBody(request.body, options.maxBytes ?? 30 * 1024 * 1024, 'fattura-elettronica-api'),
  );
  if (!parsed.success)
    throw new WebhookAuthenticationError(
      'fattura-elettronica-api: unexpected webhook payload (only format v2 is supported)',
    );
  return parsed.data;
}
