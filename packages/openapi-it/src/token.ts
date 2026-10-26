import {
  assertHttpsBaseUrl,
  HttpClient,
  ProviderError,
  providerErrorFor,
} from '@massimiliano-dev/fatturapa-core';
import type { Dispatcher } from 'undici';
import { OPENAPI_IT_HOSTS, type OpenapiItEnvironment } from './provider.js';
import { tokenResponse } from './schemas.js';

/** OAuth hosts of Openapi.it (`servers` of oauth.openapi.json). */
export const OPENAPI_IT_OAUTH_HOSTS = {
  production: 'https://oauth.openapi.it',
  sandbox: 'https://test.oauth.openapi.it',
} as const;

/** The SDI operations used by {@link OpenapiItProvider}, as `METHOD:host/path` scopes. */
export function openapiItSdiScopes(environment: OpenapiItEnvironment): string[] {
  const host = new URL(OPENAPI_IT_HOSTS[environment]).host;
  return [
    'POST:/invoices',
    'POST:/invoices_signature',
    'POST:/invoices_legal_storage',
    'POST:/invoices_signature_legal_storage',
    'GET:/invoices',
    'GET:/invoices_download',
    'GET:/invoices_notifications',
    'GET:/business_registry_configurations',
    'POST:/business_registry_configurations',
    'GET:/api_configurations',
    'POST:/api_configurations',
    ...(environment === 'sandbox' ? ['POST:/simulate'] : []),
  ].map((scope) => scope.replace(':/', `:${host}/`));
}

/**
 * Creates a scoped, expiring token with `POST /token` on oauth.openapi.it, authenticated with HTTP Basic
 * (account e-mail and API key). Run it from a trusted backend or a one-off script: the API key can
 * create tokens with any scope, so it must never reach clients or logs.
 *
 * @param ttlSeconds token lifetime; keep it short (default 30 days, the API allows up to one year).
 */
export async function createOpenapiItToken(input: {
  environment: OpenapiItEnvironment;
  email: string;
  apiKey: string;
  scopes?: readonly string[];
  ttlSeconds?: number;
  dispatcher?: Dispatcher;
}): Promise<{ token: string; expiresAt?: Date; scopes: string[] }> {
  const ttl = input.ttlSeconds ?? 30 * 24 * 3600;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 365 * 24 * 3600)
    throw new RangeError('ttlSeconds must be 1..31536000');
  if (/[:\r\n]/.test(input.email) || /[\r\n]/.test(input.apiKey)) throw new RangeError('Invalid credentials');
  const baseUrl = OPENAPI_IT_OAUTH_HOSTS[input.environment];
  assertHttpsBaseUrl(baseUrl);
  const basic = Buffer.from(`${input.email}:${input.apiKey}`).toString('base64');
  const http = new HttpClient({
    provider: 'openapi-it',
    baseUrl,
    authorization: () => `Basic ${basic}`,
    maxRetries: 0,
    ...(input.dispatcher ? { dispatcher: input.dispatcher } : {}),
  });
  try {
    const response = await http.send({
      method: 'POST',
      path: '/token',
      json: { scopes: input.scopes ?? openapiItSdiScopes(input.environment), ttl },
      operation: 'createToken',
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor('openapi-it', 'createToken', response);
    const parsed = tokenResponse.safeParse(response.json());
    if (!parsed.success || parsed.data.success === false) {
      throw new ProviderError('openapi-it: unexpected createToken response', {
        provider: 'openapi-it',
        operation: 'createToken',
        status: response.status,
      });
    }
    return {
      token: parsed.data.token,
      scopes: parsed.data.scopes ?? [],
      ...(parsed.data.expire ? { expiresAt: new Date(parsed.data.expire * 1000) } : {}),
    };
  } finally {
    await http.close();
  }
}
