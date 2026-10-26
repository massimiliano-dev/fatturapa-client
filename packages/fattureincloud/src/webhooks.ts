import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { FatturaPAError } from '@massimiliano-dev/fatturapa-core';

/**
 * Public key that verifies the `Authorization: Bearer <JWT>` of Fatture in Cloud webhook requests (ES256).
 * Published on developers.fattureincloud.it/docs/webhooks/notifications (Base64 of this PEM), copied on
 * 2026-10-26. Pass `publicKeyPem` to override it if Fatture in Cloud rotates the key.
 */
export const FIC_WEBHOOK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/RoHIjgY7hfXfY5p/Jy+K/FguMZ4
3TvZ9t4eN7+kxQ0MJzKtowv4CcYTFqrBm7hMB5ZWKnqLz24D6lQjSL0Ysw==
-----END PUBLIC KEY-----`;

const ISSUER = 'https://api-v2.fattureincloud.it';

/** The request is not an authentic Fatture in Cloud webhook. Answer 401 and do not process it. */
export class WebhookVerificationError extends FatturaPAError {}

export interface FicWebhookRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw body as received (needed for structured mode). */
  body?: string | Uint8Array;
  /** Query parameters (verification in `query` mode). */
  query?: Record<string, string | string[] | undefined>;
}

export interface FicWebhookVerifyOptions {
  /** Your sink URL exactly as registered in the subscription: it must equal the JWT `aud`. */
  audience: string;
  /** Expected application id (`aid` claim). Recommended when one endpoint serves several apps. */
  applicationId?: string | number;
  /** Override the published key (PEM or KeyObject). */
  publicKey?: string | KeyObject;
  /** Allowed clock skew in seconds. Default 60. */
  clockSkewSeconds?: number;
  /** Current time, for tests. */
  now?: Date;
  /** Maximum body size. Default 1 MiB (notifications carry ids only). */
  maxBytes?: number;
}

/** A verified event. `ids` are the affected resources: read them with the API before acting. */
export interface FicWebhookEvent {
  id: string;
  type: string;
  /** `company:<id>`. */
  subject: string;
  companyId: number;
  time?: string;
  ids: number[];
}

let defaultKey: KeyObject | undefined;

function header(headers: FicWebhookRequest['headers'], name: string): string | undefined {
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  const value = entry?.[1];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment))
    throw new WebhookVerificationError(`webhook JWT ${what} is not base64url`);
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new WebhookVerificationError(`webhook JWT ${what} is not JSON`);
  }
}

/**
 * Verifies the JWT that Fatture in Cloud puts in the `Authorization` header of every webhook request
 * (verification and notifications): ES256 signature with the published key, `iss`, `aud` (your sink
 * URL), `exp`/`iat` with clock skew, optional `aid`. Returns the claims.
 *
 * The algorithm is fixed to ES256: the JWT header cannot downgrade it (no `none`, no HMAC with the
 * public key as secret).
 */
export function verifyFicWebhookToken(
  request: FicWebhookRequest,
  options: FicWebhookVerifyOptions,
): Record<string, unknown> {
  const auth = header(request.headers, 'authorization');
  const match =
    auth === undefined ? null : /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(auth);
  if (!match) throw new WebhookVerificationError('webhook request has no bearer JWT');
  const [, h, p, sig] = match as unknown as [string, string, string, string];
  if (auth!.length > 8192) throw new WebhookVerificationError('webhook JWT too long');
  const jwtHeader = decodeSegment(h, 'header');
  if (jwtHeader.alg !== 'ES256') throw new WebhookVerificationError('webhook JWT algorithm is not ES256');
  if ('crit' in jwtHeader) throw new WebhookVerificationError('webhook JWT has unsupported critical headers');

  const key =
    options.publicKey === undefined
      ? (defaultKey ??= createPublicKey(FIC_WEBHOOK_PUBLIC_KEY_PEM))
      : typeof options.publicKey === 'string'
        ? createPublicKey(options.publicKey)
        : options.publicKey;
  const signature = Buffer.from(sig, 'base64url');
  if (signature.byteLength !== 64)
    throw new WebhookVerificationError('webhook JWT signature has the wrong length');
  const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, signature);
  if (!ok) throw new WebhookVerificationError('webhook JWT signature is invalid');

  const claims = decodeSegment(p, 'payload');
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (claims.iss !== ISSUER) throw new WebhookVerificationError('webhook JWT issuer is wrong');
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(options.audience))
    throw new WebhookVerificationError('webhook JWT audience does not match the sink URL');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now)
    throw new WebhookVerificationError('webhook JWT expired');
  if (typeof claims.iat === 'number' && claims.iat - skew > now)
    throw new WebhookVerificationError('webhook JWT issued in the future');
  if (options.applicationId !== undefined && String(claims.aid) !== String(options.applicationId)) {
    throw new WebhookVerificationError('webhook JWT application id does not match');
  }
  return claims;
}

/**
 * Handles the subscription verification request: verifies the JWT, then returns the response body to
 * send with status 200 (`{ verification: <challenge> }`). The challenge arrives in the
 * `x-fic-verification-challenge` header (header mode) or query parameter (query mode).
 */
export function handleFicVerification(
  request: FicWebhookRequest,
  options: FicWebhookVerifyOptions,
): { verification: string } {
  verifyFicWebhookToken(request, options);
  const fromQuery = request.query?.['x-fic-verification-challenge'];
  const challenge =
    header(request.headers, 'x-fic-verification-challenge') ??
    (Array.isArray(fromQuery) ? fromQuery[0] : fromQuery);
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,512}$/.test(challenge)) {
    throw new WebhookVerificationError('verification request has no valid challenge');
  }
  return { verification: challenge };
}

/**
 * Verifies a webhook notification and returns the event. Supports both CloudEvents modes: binary
 * (`ce-*` headers, body = data) and structured (`application/cloudevents+json`). The JWT `jti` must
 * equal the event id and `sub` the event subject, which binds the signature to this event.
 *
 * Delivery is at-least-once: deduplicate on `id`. The payload has ids only: fetch the resources.
 */
export function verifyFicWebhook(
  request: FicWebhookRequest,
  options: FicWebhookVerifyOptions,
): FicWebhookEvent {
  const claims = verifyFicWebhookToken(request, options);
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const raw =
    request.body === undefined
      ? ''
      : typeof request.body === 'string'
        ? request.body
        : Buffer.from(request.body).toString('utf8');
  if (Buffer.byteLength(raw) > maxBytes)
    throw new WebhookVerificationError(`webhook body exceeds ${maxBytes} bytes`);
  let body: unknown;
  try {
    body = raw === '' ? {} : JSON.parse(raw);
  } catch {
    throw new WebhookVerificationError('webhook body is not JSON');
  }
  const contentType = header(request.headers, 'content-type') ?? '';
  const structured = contentType.toLowerCase().startsWith('application/cloudevents+json');
  const envelope = structured ? (body as Record<string, unknown>) : undefined;
  const id = structured ? envelope?.id : header(request.headers, 'ce-id');
  const type = structured ? envelope?.type : header(request.headers, 'ce-type');
  const subject = structured ? envelope?.subject : header(request.headers, 'ce-subject');
  const time = structured ? envelope?.time : header(request.headers, 'ce-time');
  const data = (structured ? envelope?.data : body) as { ids?: unknown } | undefined;

  if (typeof id !== 'string' || typeof type !== 'string' || typeof subject !== 'string') {
    throw new WebhookVerificationError('webhook event attributes are missing');
  }
  if (claims.jti !== id) throw new WebhookVerificationError('webhook JWT jti does not match the event id');
  if (claims.sub !== subject)
    throw new WebhookVerificationError('webhook JWT subject does not match the event subject');
  if (!type.startsWith('it.fattureincloud.webhooks.'))
    throw new WebhookVerificationError('unexpected webhook event type');
  const company = /^company:(\d{1,18})$/.exec(subject);
  if (!company) throw new WebhookVerificationError('unexpected webhook subject');
  const ids = Array.isArray(data?.ids) ? data.ids : [];
  if (ids.length > 10_000 || !ids.every((x) => Number.isSafeInteger(x)))
    throw new WebhookVerificationError('webhook ids are invalid');
  return {
    id,
    type,
    subject,
    companyId: Number(company[1]),
    ...(typeof time === 'string' ? { time } : {}),
    ids: ids as number[],
  };
}
