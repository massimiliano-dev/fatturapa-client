import {
  parseJsonBody,
  verifyHttpMessageSignature,
  verifyStaticSecret,
  type SignedRequest,
} from '@massimiliano-dev/fatturapa-core';
import type { KeyObject } from 'node:crypto';
import type { AcubeEnvironment } from './provider.js';

/**
 * Ed25519 public keys used by A-Cube to sign webhook calls (keyid `acube`), as served on 2026-10-26 by
 * `https://common.api.acubeapi.com/signature-public-key?environment=<env>`. Pass `publicKey` to use a
 * fresher copy if A-Cube rotates them.
 */
export const ACUBE_WEBHOOK_PUBLIC_KEYS: Record<AcubeEnvironment, string> = {
  sandbox:
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAj4mDS2iuiH4CmOAD6VsmdrG6aDQZZ2trAVMg1rl+pSw=\n-----END PUBLIC KEY-----\n',
  production:
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAvZlhiFh4aORWSC9hKZvZyKYgn2g2VeSguWoxu4fbqRI=\n-----END PUBLIC KEY-----\n',
};

/** Components A-Cube covers (docs: HTTP signature): method, authority, target URI, date and body digest. */
export const ACUBE_SIGNED_COMPONENTS = [
  '@method',
  '@authority',
  '@target-uri',
  'date',
  'content-digest',
] as const;

export interface AcubeWebhookOptions {
  environment: AcubeEnvironment;
  /** The `target_url` registered for this webhook, exactly. */
  url: string;
  publicKey?: string | KeyObject;
  /** Maximum age of the signature. Default 300 s. TODO(verify): A-Cube documents no tolerance. */
  maxAgeSeconds?: number;
  /** If you configured a static token too, the expected `Authorization` value (checked as well). */
  expectedAuthorization?: string;
  maxBytes?: number;
  now?: Date;
}

/**
 * Verifies an A-Cube webhook call: RFC 9421 HTTP Message Signature with Ed25519 over method, authority,
 * target URI, `date` and `content-digest`, plus the SHA-256 body digest; optionally the static token.
 * Returns the JSON payload (for `customer-invoice` the Invoice resource). Deliveries are retried up to 15
 * times: make processing idempotent.
 *
 * @throws {WebhookAuthenticationError} if the call is not authentic.
 */
export function verifyAcubeWebhook(request: SignedRequest, options: AcubeWebhookOptions): unknown {
  verifyHttpMessageSignature(request, {
    provider: 'acube',
    keys: { acube: options.publicKey ?? ACUBE_WEBHOOK_PUBLIC_KEYS[options.environment] },
    url: options.url,
    requiredComponents: ACUBE_SIGNED_COMPONENTS,
    ...(options.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: options.maxAgeSeconds }),
    ...(options.now ? { now: options.now } : {}),
  });
  if (options.expectedAuthorization !== undefined) {
    verifyStaticSecret(request.headers, { expected: options.expectedAuthorization, provider: 'acube' });
  }
  return parseJsonBody(request.body, options.maxBytes ?? 10 * 1024 * 1024, 'acube');
}
