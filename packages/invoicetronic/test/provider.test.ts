import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFatturaXml,
  computeTotals,
  hmacSha256Hex,
  ProviderValidationError,
  WebhookAuthenticationError,
} from '@massimiliano-dev/fatturapa-core';
import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import { InvoicetronicProvider, mapInvoicetronicState, verifyInvoicetronicWebhook } from '../src/index.js';

const KEY = 'ik_test_not_a_real_key';
const API = 'https://api.invoicetronic.com';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});
const provider = () => new InvoicetronicProvider({ apiKey: KEY, dispatcher: agent });

describe('InvoicetronicProvider', () => {
  it('sends XML with Basic auth (key as user), validation and an idempotency key', async () => {
    const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
    let seen: { path?: string; headers?: Record<string, string>; body?: unknown } = {};
    agent
      .get(API)
      .intercept({ path: (p) => p.startsWith('/v1/send/xml'), method: 'POST' })
      .reply((opts) => {
        seen = { path: opts.path, headers: opts.headers as Record<string, string>, body: opts.body };
        return { statusCode: 201, data: { id: 42, payload: '', latest_state: null } };
      });
    const result = await provider().send({ xml }, { idempotencyKey: 'invoice-FPR-1-26', signature: 'None' });
    expect(result).toEqual({ provider: 'invoicetronic', id: '42', status: 'queued' });
    expect(seen.path).toBe('/v1/send/xml?validate=true&signature=None');
    expect(seen.headers?.authorization).toBe(`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
    expect(seen.headers?.['idempotency-key']).toBe('invoice-FPR-1-26');
    expect(seen.body).toBe(xml);
  });

  it('refuses keys of the other environment and bad idempotency keys', async () => {
    expect(() => new InvoicetronicProvider({ apiKey: 'ik_live_x' })).toThrow(/sandbox/);
    expect(() => new InvoicetronicProvider({ apiKey: KEY, environment: 'live' })).toThrow(/live/);
    await expect(provider().send({ xml: '<x/>' }, { idempotencyKey: 'a\nb' })).rejects.toThrow(RangeError);
  });

  it('maps validation errors and the status, with SDI errors for rejections', async () => {
    const pool = agent.get(API);
    pool
      .intercept({ path: (p) => p.startsWith('/v1/send/xml'), method: 'POST' })
      .reply(422, { title: 'Validation failed', detail: '00423 PrezzoTotale' });
    await expect(provider().send({ xml: '<x/>' })).rejects.toBeInstanceOf(ProviderValidationError);
    pool.intercept({ path: '/v1/send/42', method: 'GET' }).reply(200, {
      id: 42,
      payload: '',
      latest_state: 'Scartato',
      identifier: '999',
      file_name: 'IT01234567897_00001.xml',
    });
    pool.intercept({ path: '/v1/update?send_id=42&state=Scartato', method: 'GET' }).reply(200, [
      {
        id: 1,
        send_id: 42,
        state: 'Scartato',
        errors: [{ code: '00423', description: 'PrezzoTotale non calcolato', hint: 'Ricalcola' }],
      },
    ]);
    expect(await provider().getStatus('42')).toEqual({
      provider: 'invoicetronic',
      id: '42',
      status: 'rejected',
      providerStatus: 'Scartato',
      sdiIdentifier: '999',
      sdiFileName: 'IT01234567897_00001.xml',
      errors: [{ code: '00423', description: 'PrezzoTotale non calcolato - Ricalcola' }],
    });
    expect(mapInvoicetronicState('DecorrenzaTermini')).toBe('deadline-expired');
    await expect(provider().getStatus('4/2')).rejects.toThrow(RangeError);
  });

  it('decodes payloads', () => {
    expect(
      new TextDecoder().decode(
        InvoicetronicProvider.decodePayload({
          payload: Buffer.from('<x/>').toString('base64'),
          encoding: 'Base64',
        }),
      ),
    ).toBe('<x/>');
    expect(() => InvoicetronicProvider.decodePayload({})).toThrow(/includePayload/);
  });
});

describe('verifyInvoicetronicWebhook', () => {
  const secret = 'wh_sec_' + 'x'.repeat(32);
  const now = new Date('2026-05-20T10:00:00Z');
  const t = Math.floor(now.getTime() / 1000);
  const body = JSON.stringify({
    id: 7,
    company_id: 3,
    resource_id: 42,
    endpoint: 'update',
    method: 'POST',
    status_code: 201,
    success: true,
    date_time: '2026-05-20T10:00:00Z',
  });
  const header = (b = body, ts = t, s = secret) => `t=${ts},v1=${hmacSha256Hex(s, `${ts}.${b}`)}`;

  it('accepts a valid signature', () => {
    const event = verifyInvoicetronicWebhook(
      { headers: { 'Invoicetronic-Signature': header(), 'invoicetronic-delivery-attempt': '2' }, body },
      { secret, now },
    );
    expect(event).toEqual({
      id: 7,
      endpoint: 'update',
      method: 'POST',
      companyId: 3,
      resourceId: 42,
      success: true,
      dateTime: '2026-05-20T10:00:00Z',
      attempt: 2,
    });
  });

  it('rejects forged, stale or altered deliveries', () => {
    const cases = [
      { headers: { 'invoicetronic-signature': header(body, t, 'wh_sec_wrong_secret_xxxxxxxxxxxxxx') }, body },
      { headers: { 'invoicetronic-signature': header() }, body: body.replace('42', '43') },
      { headers: { 'invoicetronic-signature': header(body, t - 3600) }, body },
      { headers: { 'invoicetronic-signature': 'garbage' }, body },
      { headers: {}, body },
    ];
    for (const c of cases)
      expect(() => verifyInvoicetronicWebhook(c, { secret, now })).toThrow(WebhookAuthenticationError);
  });
});
