import { generateKeyPairSync, sign, createPublicKey } from 'node:crypto';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeTotals, ProviderValidationError } from '@massimiliano-dev/fatturapa-core';
import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import {
  buildFicAuthorizationUrl,
  createOAuthState,
  exchangeFicAuthorizationCode,
  FattureInCloudProvider,
  FIC_WEBHOOK_PUBLIC_KEY_PEM,
  FicMappingError,
  handleFicVerification,
  mapFicEInvoiceStatus,
  toFicIssuedDocument,
  verifyFicWebhook,
  WebhookVerificationError,
  type FicVatType,
} from '../src/index.js';

const VAT_TYPES: FicVatType[] = [
  { id: 0, value: 22, description: '22%', e_invoice: true, ei_type: null },
  { id: 10, value: 0, description: 'Escluso art. 15', e_invoice: true, ei_type: 'N1' },
  { id: 21, value: 0, description: 'Non soggetto', e_invoice: true, ei_type: 'N2.2' },
];
const API = 'https://api-v2.fattureincloud.it';

let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});

describe('toFicIssuedDocument', () => {
  it('maps buyer, lines, VAT types, discount and payments', () => {
    const doc = toFicIssuedDocument(computeTotals(syntheticInvoice()), VAT_TYPES);
    expect(doc).toMatchObject({
      type: 'invoice',
      date: '2026-05-20',
      e_invoice: true,
      entity: {
        type: 'company',
        name: 'Cliente di Prova S.p.A.',
        vat_number: '09876543217',
        ei_code: '0000000',
        country_iso: 'IT',
      },
      ei_data: { payment_method: 'MP05' },
    });
    expect(doc.items_list).toEqual([
      { name: 'Consulenza informatica', qty: 10, measure: 'ore', net_price: 50, vat: { id: 0 } },
      { name: 'Licenza software annuale', qty: 1, net_price: 199.99, discount: 10, vat: { id: 0 } },
      { name: 'Rimborso spese anticipate', qty: 1, net_price: 12.3, vat: { id: 21 } },
    ]);
    expect(doc.payments_list).toEqual([{ amount: 841.89, due_date: '2026-06-19', status: 'not_paid' }]);
    expect(doc).not.toHaveProperty('number');
  });

  it('uses the invoice number when asked', () => {
    const inv = computeTotals(syntheticInvoice());
    inv.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Numero = '12/A';
    expect(toFicIssuedDocument(inv, VAT_TYPES, { numbering: 'invoice' })).toMatchObject({
      number: 12,
      numeration: '/A',
    });
    inv.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Numero = 'FPR 1/26';
    expect(() => toFicIssuedDocument(inv, VAT_TYPES, { numbering: 'invoice' })).toThrow(FicMappingError);
  });

  it('refuses what it cannot express instead of dropping it', () => {
    const withholding = computeTotals(syntheticInvoice());
    withholding.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.DatiRitenuta = [
      { TipoRitenuta: 'RT01', ImportoRitenuta: '10.00', AliquotaRitenuta: '20.00', CausalePagamento: 'A' },
    ];
    expect(() => toFicIssuedDocument(withholding, VAT_TYPES)).toThrow(/Withholding tax/);
    const unknownVat = computeTotals(syntheticInvoice());
    unknownVat.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.AliquotaIVA = '10.00';
    expect(() => toFicIssuedDocument(unknownVat, VAT_TYPES)).toThrow(/no enabled VAT type/);
    const selfInvoice = computeTotals(syntheticInvoice());
    selfInvoice.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.TipoDocumento = 'TD17';
    expect(() => toFicIssuedDocument(selfInvoice, VAT_TYPES)).toThrow(/TD17/);
  });
});

describe('FattureInCloudProvider', () => {
  function provider() {
    return new FattureInCloudProvider({ companyId: 42, accessToken: 'access-token-test', dispatcher: agent });
  }

  it('creates, verifies and sends the e-invoice', async () => {
    const pool = agent.get(API);
    pool.intercept({ path: '/c/42/info/vat_types', method: 'GET' }).reply(200, { data: VAT_TYPES });
    let created: unknown;
    pool.intercept({ path: '/c/42/issued_documents', method: 'POST' }).reply((opts) => {
      created = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { data: { id: 777, type: 'invoice', ei_status: 'not_sent' } } };
    });
    pool
      .intercept({ path: '/c/42/issued_documents/777/e_invoice/xml_verify', method: 'GET' })
      .reply(200, { data: { success: true } });
    pool
      .intercept({ path: '/c/42/issued_documents/777/e_invoice/send', method: 'POST' })
      .reply(200, { data: { name: 'IT01234567897_00001.xml', date: '2026-05-20' } });
    const result = await provider().send({ invoice: computeTotals(syntheticInvoice()) });
    expect(result).toEqual({ provider: 'fattureincloud', id: '777', status: 'queued' });
    expect(created).toHaveProperty('data.e_invoice', true);
  });

  it('stops when the XML check fails, without sending', async () => {
    const pool = agent.get(API);
    pool.intercept({ path: '/c/42/info/vat_types', method: 'GET' }).reply(200, { data: VAT_TYPES });
    pool.intercept({ path: '/c/42/issued_documents', method: 'POST' }).reply(200, { data: { id: 778 } });
    pool
      .intercept({ path: '/c/42/issued_documents/778/e_invoice/xml_verify', method: 'GET' })
      .reply(422, { error: { message: 'Invalid', validation_result: { xml_errors: ['CAP non valido'] } } });
    const err = await provider()
      .send({ invoice: computeTotals(syntheticInvoice()) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderValidationError);
    expect((err as ProviderValidationError).details.messages).toEqual(['document 778', 'CAP non valido']);
  });

  it('refuses raw XML', async () => {
    await expect(provider().send({ xml: '<x/>' })).rejects.toThrow(/pass `invoice`/);
  });

  it('maps e-invoice statuses and adds the rejection reason', async () => {
    const pool = agent.get(API);
    pool
      .intercept({ path: '/c/42/issued_documents/777?fieldset=detailed', method: 'GET' })
      .reply(200, { data: { id: 777, ei_status: 'discarded' } });
    pool
      .intercept({ path: '/c/42/issued_documents/777/e_invoice/error_reason', method: 'GET' })
      .reply(200, { data: { reason: 'Fattura duplicata', code: '00404' } });
    expect(await provider().getStatus('777')).toEqual({
      provider: 'fattureincloud',
      id: '777',
      status: 'rejected',
      providerStatus: 'discarded',
      errors: [{ code: '00404', description: 'Fattura duplicata' }],
    });
    expect(mapFicEInvoiceStatus('no_response')).toBe('deadline-expired');
    await expect(provider().getStatus('../1')).rejects.toThrow(RangeError);
  });
});

describe('OAuth', () => {
  it('builds the authorization URL with state and space-separated scopes', () => {
    const state = createOAuthState();
    const url = new URL(
      buildFicAuthorizationUrl({
        clientId: 'cid',
        redirectUri: 'https://app.example.com/cb',
        scopes: ['issued_documents.invoices:a', 'settings:r'],
        state,
      }),
    );
    expect(url.origin + url.pathname).toBe('https://api-v2.fattureincloud.it/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('issued_documents.invoices:a settings:r');
    expect(url.searchParams.get('state')).toBe(state);
    expect(() =>
      buildFicAuthorizationUrl({
        clientId: 'c',
        redirectUri: 'http://app.example.com/cb',
        scopes: [],
        state,
      }),
    ).toThrow(/https/);
    expect(() =>
      buildFicAuthorizationUrl({
        clientId: 'c',
        redirectUri: 'https://a.example/cb',
        scopes: [],
        state: 'x',
      }),
    ).toThrow(/state/);
  });

  it('exchanges the code without an Authorization header', async () => {
    let headers: Record<string, string> = {};
    agent
      .get(API)
      .intercept({ path: '/oauth/token', method: 'POST' })
      .reply((opts) => {
        headers = opts.headers as Record<string, string>;
        return {
          statusCode: 200,
          data: { token_type: 'bearer', access_token: 'a', refresh_token: 'r', expires_in: 86400 },
        };
      });
    const tokens = await exchangeFicAuthorizationCode({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://a.example/cb',
      code: 'k',
      dispatcher: agent,
    });
    expect(tokens.accessToken).toBe('a');
    expect(headers).not.toHaveProperty('authorization');
  });
});

describe('webhooks', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const audience = 'https://hooks.example.com/fic';
  const now = new Date('2026-05-20T10:00:00Z');
  const iat = Math.floor(now.getTime() / 1000);

  function jwt(
    claims: Record<string, unknown>,
    header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT' },
    key = privateKey,
  ): string {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const s = sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }).toString(
      'base64url',
    );
    return `${h}.${p}.${s}`;
  }
  const baseClaims = {
    iss: 'https://api-v2.fattureincloud.it',
    aud: audience,
    sub: 'company:108061',
    jti: 'evt-1',
    iat,
    exp: iat + 3 * 3600,
    aid: 99,
  };
  const ceHeaders = {
    'ce-id': 'evt-1',
    'ce-type': 'it.fattureincloud.webhooks.issued_documents.e_invoices.status_update',
    'ce-subject': 'company:108061',
    'ce-time': '2026-05-20T12:00:00+02:00',
    'content-type': 'application/json',
  };
  const opts = { audience, publicKey, now, applicationId: 99 };

  it('the published key is a P-256 public key', () => {
    expect(createPublicKey(FIC_WEBHOOK_PUBLIC_KEY_PEM).asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
  });

  it('verifies binary and structured notifications', () => {
    const binary = verifyFicWebhook(
      { headers: { ...ceHeaders, authorization: `Bearer ${jwt(baseClaims)}` }, body: '{"ids":[1,2]}' },
      opts,
    );
    expect(binary).toEqual({
      id: 'evt-1',
      type: ceHeaders['ce-type'],
      subject: 'company:108061',
      companyId: 108061,
      time: ceHeaders['ce-time'],
      ids: [1, 2],
    });
    const structured = verifyFicWebhook(
      {
        headers: {
          authorization: `Bearer ${jwt(baseClaims)}`,
          'content-type': 'application/cloudevents+json',
        },
        body: JSON.stringify({
          id: 'evt-1',
          type: ceHeaders['ce-type'],
          subject: 'company:108061',
          specversion: '1.0',
          data: { ids: [3] },
        }),
      },
      opts,
    );
    expect(structured.ids).toEqual([3]);
  });

  it('rejects forged, replayed or mismatched requests', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const cases: [string, Record<string, unknown>][] = [
      ['wrong key', { ...ceHeaders, authorization: `Bearer ${jwt(baseClaims, undefined, other)}` }],
      ['alg none', { ...ceHeaders, authorization: `Bearer ${jwt(baseClaims, { alg: 'none' })}` }],
      ['HS256', { ...ceHeaders, authorization: `Bearer ${jwt(baseClaims, { alg: 'HS256' })}` }],
      [
        'audience',
        { ...ceHeaders, authorization: `Bearer ${jwt({ ...baseClaims, aud: 'https://evil.example' })}` },
      ],
      [
        'issuer',
        { ...ceHeaders, authorization: `Bearer ${jwt({ ...baseClaims, iss: 'https://evil.example' })}` },
      ],
      ['expired', { ...ceHeaders, authorization: `Bearer ${jwt({ ...baseClaims, exp: iat - 3600 })}` }],
      ['jti', { ...ceHeaders, 'ce-id': 'evt-2', authorization: `Bearer ${jwt(baseClaims)}` }],
      ['subject', { ...ceHeaders, 'ce-subject': 'company:1', authorization: `Bearer ${jwt(baseClaims)}` }],
      ['app', { ...ceHeaders, authorization: `Bearer ${jwt({ ...baseClaims, aid: 1 })}` }],
      ['missing', { ...ceHeaders }],
      ['no iat', { ...ceHeaders, authorization: `Bearer ${jwt({ ...baseClaims, iat: undefined })}` }],
    ];
    for (const [label, headers] of cases) {
      expect(
        () => verifyFicWebhook({ headers: headers as Record<string, string>, body: '{"ids":[1]}' }, opts),
        label,
      ).toThrow(WebhookVerificationError);
    }
  });

  it('can limit the token age', () => {
    const old = jwt({ ...baseClaims, iat: iat - 3600 });
    const req = { headers: { ...ceHeaders, authorization: `Bearer ${old}` }, body: '{"ids":[1]}' };
    expect(verifyFicWebhook(req, opts).id).toBe('evt-1');
    expect(() => verifyFicWebhook(req, { ...opts, maxAgeSeconds: 300 })).toThrow(/too old/);
  });

  it('answers the verification challenge only for authentic requests', () => {
    const token = jwt({ ...baseClaims, jti: 'verify-1' });
    expect(
      handleFicVerification(
        { headers: { authorization: `Bearer ${token}`, 'x-fic-verification-challenge': 'abc123' } },
        opts,
      ),
    ).toEqual({ verification: 'abc123' });
    expect(
      handleFicVerification(
        { headers: { authorization: `Bearer ${token}` }, query: { 'x-fic-verification-challenge': 'q1' } },
        opts,
      ),
    ).toEqual({ verification: 'q1' });
    expect(() => handleFicVerification({ headers: { 'x-fic-verification-challenge': 'abc' } }, opts)).toThrow(
      WebhookVerificationError,
    );
    expect(() =>
      handleFicVerification(
        { headers: { authorization: `Bearer ${token}`, 'x-fic-verification-challenge': '<script>' } },
        opts,
      ),
    ).toThrow(/challenge/);
  });
});
