import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { FatturaPAError } from './errors.js';

/** A webhook or callback request is not authentic. Answer 401 and do not process it. */
export class WebhookAuthenticationError extends FatturaPAError {}

/** Compares two strings in constant time (independent of where they differ and of their lengths). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Case-insensitive single header lookup; repeated headers are refused (they could smuggle values). */
export function singleHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  const matches = Object.entries(headers).filter(([k]) => k.toLowerCase() === lower);
  if (matches.length !== 1) return undefined;
  const value = matches[0]![1];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

/** Minimum length of a shared secret used to authenticate callbacks. */
export const MIN_SHARED_SECRET_LENGTH = 32;

/**
 * Checks a static secret sent by a provider in a header (e.g. `Authorization: Bearer <secret>`).
 * Static secrets authenticate the caller but do not protect the body: re-read the resource through the
 * provider's API before acting on it.
 *
 * @throws {WebhookAuthenticationError} if the header is missing, repeated or wrong.
 */
export function verifyStaticSecret(
  headers: Record<string, string | string[] | undefined>,
  options: { expected: string; headerName?: string; provider: string },
): void {
  if (options.expected.length < MIN_SHARED_SECRET_LENGTH) {
    throw new RangeError(`the expected secret must be at least ${MIN_SHARED_SECRET_LENGTH} characters`);
  }
  const value = singleHeader(headers, options.headerName ?? 'authorization');
  if (value === undefined || !constantTimeEqual(value, options.expected)) {
    throw new WebhookAuthenticationError(`${options.provider}: missing or wrong callback secret`);
  }
}

/** Hex HMAC-SHA256. */
export function hmacSha256Hex(secret: string | Uint8Array, data: string | Uint8Array): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Raw body as bytes. */
export function bodyBytes(body: string | Uint8Array | undefined): Buffer {
  if (body === undefined) return Buffer.alloc(0);
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

/** Parses a JSON body with a size cap. */
export function parseJsonBody(
  body: string | Uint8Array | undefined,
  maxBytes: number,
  provider: string,
): unknown {
  const bytes = bodyBytes(body);
  if (bytes.byteLength > maxBytes)
    throw new WebhookAuthenticationError(`${provider}: body exceeds ${maxBytes} bytes`);
  try {
    return bytes.byteLength === 0 ? undefined : (JSON.parse(bytes.toString('utf8')) as unknown);
  } catch {
    throw new WebhookAuthenticationError(`${provider}: body is not JSON`);
  }
}
