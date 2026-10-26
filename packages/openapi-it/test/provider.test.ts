import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFatturaXml,
  computeTotals,
  ProviderAuthError,
  ProviderPaymentRequiredError,
  ProviderTransportError,
  ProviderValidationError,
} from '@massimiliano-dev/fatturapa-core';
import { syntheticIban, syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import {
  CallbackVerificationError,
  createOpenapiItToken,
  mapOpenapiItMarking,
  OpenapiItProvider,
  openapiItSdiScopes,
  verifyOpenapiItCallback,
} from '../src/index.js';

const TOKEN = 'test-token-not-a-real-secret';
let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});

function provider(): OpenapiItProvider {
  return new OpenapiItProvider({ environment: 'sandbox', token: TOKEN, dispatcher: agent });
}

describe('OpenapiItProvider', () => {
  it('sends the XML as is, with the bearer token, to the sandbox host', async () => {
    const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
    let seen: { body?: unknown; headers?: unknown } = {};
    agent
      .get('https://test.sdi.openapi.it')
      .intercept({ path: '/invoices', method: 'POST' })
      .reply((opts) => {
        seen = { body: opts.body, headers: opts.headers };
        return { statusCode: 200, data: { data: { uuid: 'u-1' }, success: true, message: '', error: null } };
      });
    const result = await provider().send({ xml });
    expect(result).toEqual({ provider: 'openapi-it', id: 'u-1', status: 'queued' });
    expect(seen.body).toBe(xml);
    expect(seen.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/xml',
    });
  });

  it('picks the endpoint for signature and legal storage', async () => {
    agent
      .get('https://test.sdi.openapi.it')
      .intercept({ path: '/invoices_signature_legal_storage', method: 'POST' })
      .reply(200, { data: { uuid: 'u-2' }, success: true });
    const result = await provider().send(
      { invoice: computeTotals(syntheticInvoice()) },
      { signature: true, legalStorage: true },
    );
    expect(result.id).toBe('u-2');
  });

  it('maps HTTP errors to typed, redacted errors', async () => {
    const pool = agent.get('https://test.sdi.openapi.it');
    pool.intercept({ path: '/invoices', method: 'POST' }).reply(422, {
      success: false,
      message: `Parsing error near ${syntheticIban()}`,
      error: '802',
    });
    pool
      .intercept({ path: '/invoices', method: 'POST' })
      .reply(402, { success: false, message: 'Insufficient Credit', error: 611 });
    pool.intercept({ path: '/invoices', method: 'POST' }).reply(401, { message: 'Unauthorized' });
    const p = provider();
    const err = await p.send({ xml: '<x/>' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderValidationError);
    expect((err as Error).message).toContain('[REDACTED:IBAN]');
    await expect(p.send({ xml: '<x/>' })).rejects.toBeInstanceOf(ProviderPaymentRequiredError);
    await expect(p.send({ xml: '<x/>' })).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('does not follow redirects (the token must not leave the configured origin)', async () => {
    agent
      .get('https://test.sdi.openapi.it')
      .intercept({ path: '/invoices/u-1', method: 'GET' })
      .reply(302, '', { headers: { location: 'https://evil.example/steal' } });
    await expect(provider().getStatus('u-1')).rejects.toThrow(/HTTP 302/);
  });

  it('reads the status and maps the marking', async () => {
    agent
      .get('https://test.sdi.openapi.it')
      .intercept({ path: '/invoices/u-1', method: 'GET' })
      .reply(200, {
        data: {
          uuid: 'u-1',
          marking: 'rejected',
          sdi_file_id: 123,
          sdi_file_name: 'IT01234567897_00001.xml',
          notice: 'Scartata',
        },
        success: true,
      });
    expect(await provider().getStatus('u-1')).toEqual({
      provider: 'openapi-it',
      id: 'u-1',
      status: 'rejected',
      providerStatus: 'rejected',
      sdiIdentifier: '123',
      sdiFileName: 'IT01234567897_00001.xml',
      errors: [{ description: 'Scartata' }],
    });
    expect(mapOpenapiItMarking('accepted-pa')).toBe('accepted');
    expect(mapOpenapiItMarking('something-new')).toBe('unknown');
  });

  it('encodes path segments', async () => {
    agent
      .get('https://test.sdi.openapi.it')
      .intercept({ path: '/invoices/a%2F..%2Fb', method: 'GET' })
      .reply(404, {});
    await expect(provider().getInvoice('a/../b')).rejects.toThrow(/HTTP 404/);
    await expect(provider().getInvoice('..')).rejects.toThrow(RangeError);
  });

  it('caps the response size', async () => {
    agent
      .get('https://test.sdi.openapi.it')
      .intercept({ path: '/invoices_download/u-1', method: 'GET' })
      .reply(200, 'x'.repeat(2048));
    const p = new OpenapiItProvider({
      environment: 'sandbox',
      token: TOKEN,
      dispatcher: agent,
      maxResponseBytes: 1024,
    });
    await expect(p.downloadInvoice('u-1')).rejects.toBeInstanceOf(ProviderTransportError);
  });

  it('refuses insecure configuration', () => {
    expect(
      () =>
        new OpenapiItProvider({
          environment: 'sandbox',
          token: TOKEN,
          baseUrl: 'http://test.sdi.openapi.it',
        }),
    ).toThrow(/https/);
    expect(() => new OpenapiItProvider({ environment: 'sandbox', token: '' })).toThrow();
    expect(() => new OpenapiItProvider({ environment: 'prod' as 'production', token: TOKEN })).toThrow();
  });

  it('refuses sandbox simulation in production and weak callback secrets', async () => {
    const prod = new OpenapiItProvider({ environment: 'production', token: TOKEN, dispatcher: agent });
    await expect(prod.simulate('customer-notification', {})).rejects.toThrow(/sandbox/);
    await expect(
      provider().configureCallbacks('01234567897', [
        { event: 'customer-notification', url: 'https://example.com/cb', authorization: 'short' },
      ]),
    ).rejects.toThrow(/32 characters/);
    await expect(
      provider().configureCallbacks('01234567897', [
        { event: 'customer-notification', url: 'http://example.com/cb', authorization: 'x'.repeat(40) },
      ]),
    ).rejects.toThrow(/https/);
  });

  it('creates scoped tokens with Basic auth', async () => {
    let auth: unknown;
    let body: unknown;
    agent
      .get('https://test.oauth.openapi.it')
      .intercept({ path: '/token', method: 'POST' })
      .reply((opts) => {
        auth = (opts.headers as Record<string, string>).authorization;
        body = JSON.parse(String(opts.body));
        return {
          statusCode: 200,
          data: {
            token: 'new-token',
            expire: 1800000000,
            scopes: ['GET:test.sdi.openapi.it/invoices'],
            success: true,
          },
        };
      });
    const result = await createOpenapiItToken({
      environment: 'sandbox',
      email: 'dev@example.com',
      apiKey: 'k',
      ttlSeconds: 3600,
      dispatcher: agent,
    });
    expect(result.token).toBe('new-token');
    expect(auth).toBe(`Basic ${Buffer.from('dev@example.com:k').toString('base64')}`);
    expect(body).toMatchObject({ ttl: 3600, scopes: openapiItSdiScopes('sandbox') });
    expect(openapiItSdiScopes('sandbox')).toContain('POST:test.sdi.openapi.it/invoices');
  });
});

describe('verifyOpenapiItCallback', () => {
  const secret = 'Bearer ' + 'a'.repeat(40);
  it('accepts the configured secret and returns the payload field', () => {
    const payload = verifyOpenapiItCallback(
      { headers: { Authorization: secret }, body: JSON.stringify({ data: { uuid: 'u-1' } }) },
      { expectedAuthorization: secret },
    );
    expect(payload).toEqual({ uuid: 'u-1' });
  });
  it('rejects missing or wrong secrets and non-JSON bodies', () => {
    expect(() =>
      verifyOpenapiItCallback({ headers: {}, body: '{}' }, { expectedAuthorization: secret }),
    ).toThrow(CallbackVerificationError);
    expect(() =>
      verifyOpenapiItCallback(
        { headers: { authorization: secret + 'x' }, body: '{}' },
        { expectedAuthorization: secret },
      ),
    ).toThrow(CallbackVerificationError);
    expect(() =>
      verifyOpenapiItCallback(
        { headers: { authorization: [secret, secret] }, body: '{}' },
        { expectedAuthorization: secret },
      ),
    ).toThrow(CallbackVerificationError);
    expect(() =>
      verifyOpenapiItCallback(
        { headers: { authorization: secret }, body: 'nope' },
        { expectedAuthorization: secret },
      ),
    ).toThrow(/not JSON/);
    expect(() =>
      verifyOpenapiItCallback(
        { headers: { authorization: 'x' }, body: '{}' },
        { expectedAuthorization: 'short' },
      ),
    ).toThrow(RangeError);
  });
});
