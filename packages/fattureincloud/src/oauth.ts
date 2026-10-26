import { randomBytes } from 'node:crypto';
import { HttpClient, ProviderError, providerErrorFor } from '@massimiliano-dev/fatturapa-core';
import type { Dispatcher } from 'undici';
import { z } from 'zod';

/** API host (`servers` of openapi-fattureincloud 2.1.8). */
export const FIC_API_BASE_URL = 'https://api-v2.fattureincloud.it';
/** OAuth2 endpoints (developers.fattureincloud.it, "Authorization Code Flow – Vanilla code"). */
export const FIC_AUTHORIZE_URL = 'https://api-v2.fattureincloud.it/oauth/authorize';
export const FIC_TOKEN_PATH = '/oauth/token';

/**
 * OAuth scopes (developers.fattureincloud.it/docs/basics/scopes). `:r` read-only, `:a` full access.
 * Ask only for what you use: e-invoicing needs `issued_documents.invoices:a` (and `.credit_notes:a` for
 * credit notes), `entity.clients:r` to reuse clients, `settings:r` for VAT types and
 * `received_documents:r` for supplier invoices.
 */
export const FIC_SCOPES = [
  'situation:r',
  'entity.clients:r',
  'entity.clients:a',
  'entity.suppliers:r',
  'entity.suppliers:a',
  'products:r',
  'products:a',
  'stock:r',
  'stock:a',
  'issued_documents.invoices:r',
  'issued_documents.invoices:a',
  'issued_documents.credit_notes:r',
  'issued_documents.credit_notes:a',
  'issued_documents.quotes:r',
  'issued_documents.quotes:a',
  'issued_documents.proformas:r',
  'issued_documents.proformas:a',
  'issued_documents.receipts:r',
  'issued_documents.receipts:a',
  'issued_documents.delivery_notes:r',
  'issued_documents.delivery_notes:a',
  'issued_documents.orders:r',
  'issued_documents.orders:a',
  'issued_documents.work_reports:r',
  'issued_documents.work_reports:a',
  'issued_documents.supplier_orders:r',
  'issued_documents.supplier_orders:a',
  'issued_documents.self_invoices:r',
  'issued_documents.self_invoices:a',
  'received_documents:r',
  'received_documents:a',
  'receipts:r',
  'receipts:a',
  'calendar:r',
  'calendar:a',
  'archive:r',
  'archive:a',
  'taxes:r',
  'taxes:a',
  'emails:r',
  'cashbook:r',
  'cashbook:a',
  'settings:r',
  'settings:a',
] as const;
export type FicScope = (typeof FIC_SCOPES)[number];

/** Tokens returned by the token endpoint. Access tokens last 24 h, refresh tokens one year from last use. */
export interface FicTokens {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token. */
  expiresAt: Date;
}

const tokenSchema = z.object({
  token_type: z.string().max(50).nullish(),
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(8192),
  expires_in: z
    .number()
    .int()
    .positive()
    .max(10 * 365 * 86400),
});

/** A random `state` for the authorization request (CSRF protection). Store it in the user's session. */
export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Builds the URL to redirect the user to. Verify on the callback that the returned `state` equals the
 * one you stored (constant-time comparison is not needed: it is not a secret once issued, but it must be
 * single-use and bound to the session).
 */
export function buildFicAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: readonly FicScope[];
  state: string;
}): string {
  if (input.state.length < 16) throw new RangeError('state must be at least 16 characters of randomness');
  const redirect = new URL(input.redirectUri);
  if (
    redirect.protocol !== 'https:' &&
    redirect.hostname !== 'localhost' &&
    redirect.hostname !== '127.0.0.1'
  ) {
    throw new RangeError('redirectUri must use https (http is allowed only for localhost)');
  }
  for (const scope of input.scopes)
    if (!(FIC_SCOPES as readonly string[]).includes(scope)) throw new RangeError(`Unknown scope ${scope}`);
  const url = new URL(FIC_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  return url.href;
}

async function tokenRequest(
  body: Record<string, string>,
  dispatcher?: Dispatcher,
  now = Date.now(),
): Promise<FicTokens> {
  const http = new HttpClient({
    provider: 'fattureincloud',
    baseUrl: FIC_API_BASE_URL,
    // The token endpoint authenticates with client_id/client_secret in the JSON body.
    authorization: () => undefined,
    maxRetries: 0,
    ...(dispatcher ? { dispatcher } : {}),
  });
  try {
    const response = await http.send({
      method: 'POST',
      path: FIC_TOKEN_PATH,
      json: body,
      operation: 'oauthToken',
    });
    if (response.status !== 200) throw providerErrorFor('fattureincloud', 'oauthToken', response);
    const parsed = tokenSchema.safeParse(response.json());
    if (!parsed.success)
      throw new ProviderError('fattureincloud: unexpected token response', {
        provider: 'fattureincloud',
        operation: 'oauthToken',
        status: 200,
      });
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: new Date(now + parsed.data.expires_in * 1000),
    };
  } finally {
    await http.close();
  }
}

/**
 * Exchanges the authorization code (valid 60 s, single use) for tokens. Run it on your backend only: it
 * needs the client secret.
 */
export function exchangeFicAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  dispatcher?: Dispatcher;
}): Promise<FicTokens> {
  return tokenRequest(
    {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
    input.dispatcher,
  );
}

/** Refreshes the tokens. Store the new refresh token: the old one should be considered consumed. */
export function refreshFicTokens(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  dispatcher?: Dispatcher;
}): Promise<FicTokens> {
  return tokenRequest(
    {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    },
    input.dispatcher,
  );
}
