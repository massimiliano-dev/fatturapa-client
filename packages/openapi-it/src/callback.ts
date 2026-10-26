import { timingSafeEqual, createHash } from 'node:crypto';
import { FatturaPAError } from '@massimiliano-dev/fatturapa-core';

/** The callback request is not authentic or not acceptable. Answer 401 and do not process it. */
export class CallbackVerificationError extends FatturaPAError {}

/** Options of {@link verifyOpenapiItCallback}. */
export interface OpenapiItCallbackOptions {
  /** The secret you configured with `configureCallbacks` (the exact header value). */
  expectedAuthorization: string;
  /** Header carrying it. Default `authorization`. */
  headerName?: string;
  /** JSON field holding the payload (the `field` of the configuration). Default `data`. */
  field?: string;
  /** Maximum body size. Default 10 MiB. */
  maxBytes?: number;
}

function constantTimeEqual(a: string, b: string): boolean {
  // Hash first so that lengths do not leak and timingSafeEqual gets equal-length inputs.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Authenticates an Openapi.it callback and returns its payload.
 *
 * Openapi.it authenticates callbacks with a static secret header, not with a signature over the body. So:
 * - the comparison is constant-time, and the secret must be long and random (≥ 32 characters);
 * - the payload is NOT integrity-protected beyond TLS: treat it as a hint and re-read the invoice with
 *   `getInvoice(uuid)` before acting on it ("fetch, then trust");
 * - expose the endpoint over HTTPS only, and rotate the secret if it may have leaked.
 *
 * @throws {CallbackVerificationError} if the secret is missing or wrong, or the body is not JSON.
 */
export function verifyOpenapiItCallback(
  request: { headers: Record<string, string | string[] | undefined>; body: string | Uint8Array },
  options: OpenapiItCallbackOptions,
): unknown {
  if (options.expectedAuthorization.length < 32)
    throw new RangeError('expectedAuthorization must be at least 32 characters');
  const name = (options.headerName ?? 'authorization').toLowerCase();
  const raw = Object.entries(request.headers).find(([k]) => k.toLowerCase() === name)?.[1];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  if (typeof value !== 'string' || !constantTimeEqual(value, options.expectedAuthorization)) {
    throw new CallbackVerificationError('openapi-it callback: missing or wrong authorization');
  }
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const bytes = typeof request.body === 'string' ? Buffer.byteLength(request.body) : request.body.byteLength;
  if (bytes > maxBytes)
    throw new CallbackVerificationError(`openapi-it callback: body exceeds ${maxBytes} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8'),
    );
  } catch {
    throw new CallbackVerificationError('openapi-it callback: body is not JSON');
  }
  const field = options.field ?? 'data';
  if (parsed !== null && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, field)) {
    return (parsed as Record<string, unknown>)[field];
  }
  return parsed;
}
