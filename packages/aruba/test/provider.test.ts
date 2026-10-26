import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeTotals,
  parseFatturaXml,
  parseSdiNotification,
  ProviderValidationError,
  WebhookAuthenticationError,
} from '@massimiliano-dev/fatturapa-core';
import { RC_PA, syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import {
  ARUBA_TRANSMITTER,
  ArubaProvider,
  mapArubaStatus,
  verifyArubaCallback,
  withArubaTransmitter,
} from '../src/index.js';

const AUTH = 'https://demoauth.fatturazioneelettronica.aruba.it';
const WS = 'https://demows.fatturazioneelettronica.aruba.it';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});
const provider = () =>
  new ArubaProvider({
    environment: 'demo',
    credentials: { username: 'utente', password: 'p@ss&word' },
    dispatcher: agent,
  });
const signin = () =>
  agent
    .get(AUTH)
    .intercept({ path: '/auth/signin', method: 'POST' })
    .reply((opts) => {
      expect(String(opts.body)).toBe('grant_type=password&username=utente&password=p%40ss%26word');
      return {
        statusCode: 200,
        data: { access_token: 'at-1', token_type: 'bearer', expires_in: 1800, refresh_token: 'rt-1' },
      };
    });

describe('ArubaProvider', () => {
  it('signs in with credentials in the body and uploads with Aruba as transmitter', async () => {
    signin();
    let upload: { dataFile: string; dryRun: boolean } | undefined;
    agent
      .get(WS)
      .intercept({ path: '/services/invoice/upload', method: 'POST' })
      .reply((opts) => {
        upload = JSON.parse(String(opts.body));
        return {
          statusCode: 200,
          data: {
            errorCode: '0000',
            errorDescription: 'Operazione effettuata - abc',
            uploadFileName: 'IT01879020517_abcde.xml.p7m',
          },
        };
      });
    const result = await provider().send({ invoice: computeTotals(syntheticInvoice()) });
    expect(result).toEqual({ provider: 'aruba', id: 'IT01879020517_abcde.xml.p7m', status: 'queued' });
    const sent = parseFatturaXml(Buffer.from(upload!.dataFile, 'base64'));
    expect(sent.FatturaElettronicaHeader.DatiTrasmissione.IdTrasmittente).toEqual(ARUBA_TRANSMITTER);
    expect(upload!.dryRun).toBe(false);
  });

  it('turns synchronous check codes into typed errors', async () => {
    signin();
    agent
      .get(WS)
      .intercept({ path: '/services/invoice/upload', method: 'POST' })
      .reply(200, { errorCode: '0092', errorDescription: 'Errore in validazione XSD', uploadFileName: null });
    const err = await provider()
      .send({ xml: '<x/>' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderValidationError);
    expect((err as ProviderValidationError).details.messages?.[0]).toBe('0092');
  });

  it('reads status and notifications', async () => {
    signin();
    const ws = agent.get(WS);
    ws.intercept({
      path: '/api/v2/invoices-out/detail?filename=IT01879020517_abcde.xml.p7m&includeFile=false',
      method: 'GET',
    }).reply(200, {
      id: '1',
      filename: 'IT01879020517_abcde.xml.p7m',
      idSdi: '7895',
      invoices: [{ number: '1', status: 'Consegnata', statusDescription: '' }],
      sdiErrors: [],
    });
    ws.intercept({
      path: '/api/v2/invoices-out/notifications?filename=IT01879020517_abcde.xml.p7m',
      method: 'GET',
    }).reply(200, {
      count: 1,
      notifications: [
        {
          docType: 'RC',
          file: Buffer.from(RC_PA).toString('base64'),
          filename: 'IT01879020517_abcde_RC_001.xml',
        },
      ],
    });
    const p = provider();
    expect(await p.getStatus('IT01879020517_abcde.xml.p7m')).toMatchObject({
      status: 'delivered',
      providerStatus: 'Consegnata',
      sdiIdentifier: '7895',
    });
    const [n] = await p.listSentNotifications('IT01879020517_abcde.xml.p7m');
    expect(parseSdiNotification(n!.xml!).type).toBe('RC');
    expect(mapArubaStatus('Recapito impossibile')).toBe('not-delivered');
    expect(mapArubaStatus('Errore Elaborazione')).toBe('error');
  });

  it('refreshes the token instead of signing in again', async () => {
    let calls = 0;
    agent
      .get(AUTH)
      .intercept({ path: '/auth/signin', method: 'POST' })
      .reply((opts) => {
        calls += 1;
        const refresh = String(opts.body).startsWith('grant_type=refresh_token');
        return {
          statusCode: 200,
          data: { access_token: refresh ? 'at-2' : 'at-1', expires_in: 1, refresh_token: 'rt-1' },
        };
      })
      .times(2);
    const ws = agent.get(WS);
    const seen: string[] = [];
    ws.intercept({ path: (p) => p.startsWith('/api/v2/invoices-out/detail'), method: 'GET' })
      .reply((opts) => {
        seen.push((opts.headers as Record<string, string>).authorization!);
        return { statusCode: 200, data: { id: '1', invoices: [{ status: 'Inviata' }] } };
      })
      .times(2);
    const p = provider();
    await p.getStatus('f1');
    await p.getStatus('f1');
    expect(seen).toEqual(['Bearer at-1', 'Bearer at-2']);
    expect(calls).toBe(2);
  });

  it('enforces Aruba rules locally', async () => {
    await expect(
      provider().searchInvoices('out', { creationStartDate: '2026-05-01', creationEndDate: '2026-05-10' }),
    ).rejects.toThrow(/two days/);
    await expect(provider().simulateNotification('f', 'RC')).rejects.toThrow(); // needs network auth in demo: mock missing
    const prod = new ArubaProvider({
      environment: 'production',
      credentials: { username: 'u', password: 'p' },
      dispatcher: agent,
    });
    await expect(prod.simulateNotification('f', 'RC')).rejects.toThrow(/demo/);
    expect(
      withArubaTransmitter(syntheticInvoice()).FatturaElettronicaHeader.DatiTrasmissione.IdTrasmittente
        .IdCodice,
    ).toBe('01879020517');
  });
});

describe('verifyArubaCallback', () => {
  const apiKey = 'a'.repeat(40);
  const body = JSON.stringify({
    username: 'utente',
    countryCode: 'IT',
    vatCode: '01234567897',
    fiscalCode: '01234567897',
    invoiceFileName: 'IT01879020517_abcde.xml.p7m',
    sdiIdentification: '7895',
    status: 'Inviata',
  });
  it('accepts the API key from an Aruba address', () => {
    const cb = verifyArubaCallback(
      'updateInvoiceStatus',
      { headers: { authorization: apiKey }, body, remoteAddress: '::ffff:62.149.180.5' },
      { apiKey },
    );
    expect(cb).toMatchObject({ kind: 'updateInvoiceStatus', data: { status: 'Inviata' } });
  });
  it('rejects other keys, other addresses and malformed bodies', () => {
    expect(() =>
      verifyArubaCallback(
        'updateInvoiceStatus',
        { headers: { authorization: 'b'.repeat(40) }, body, remoteAddress: '62.149.180.5' },
        { apiKey },
      ),
    ).toThrow(WebhookAuthenticationError);
    expect(() =>
      verifyArubaCallback(
        'updateInvoiceStatus',
        { headers: { authorization: apiKey }, body, remoteAddress: '203.0.113.9' },
        { apiKey },
      ),
    ).toThrow(/source address/);
    expect(() =>
      verifyArubaCallback(
        'createInvoice',
        { headers: { authorization: apiKey }, body, remoteAddress: '62.149.180.5' },
        { apiKey },
      ),
    ).toThrow(/malformed/);
  });
});
