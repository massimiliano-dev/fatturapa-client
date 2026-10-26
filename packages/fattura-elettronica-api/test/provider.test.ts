import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebhookAuthenticationError } from '@massimiliano-dev/fatturapa-core';
import {
  FatturaElettronicaApiProvider,
  mapFeaState,
  parseRomeLocalTime,
  verifyFatturaElettronicaApiWebhook,
} from '../src/index.js';

const HOST = 'https://fattura-elettronica-api.it';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});

describe('FatturaElettronicaApiProvider', () => {
  it('authenticates with Basic, then sends with the Bearer token', async () => {
    const pool = agent.get(HOST);
    let basic: string | undefined;
    let bearer: string | undefined;
    pool.intercept({ path: '/ws2.0/test/authentication', method: 'POST' }).reply((opts) => {
      basic = (opts.headers as Record<string, string>).authorization;
      return { statusCode: 200, data: { token: 'bearer-1', expires: '2099-01-01 10:00:00' } };
    });
    pool.intercept({ path: '/ws2.0/test/fatture', method: 'POST' }).reply((opts) => {
      bearer = (opts.headers as Record<string, string>).authorization;
      return {
        statusCode: 200,
        data: {
          id: 5,
          sdi_identificativo: null,
          sdi_nome_file: 'IT01234567897_00001.xml',
          sdi_stato: 'PREN',
          sdi_messaggio: '',
        },
      };
    });
    const p = new FatturaElettronicaApiProvider({
      environment: 'test',
      credentials: { clientId: 'cid', clientSecret: 'sec' },
      dispatcher: agent,
    });
    expect(await p.send({ xml: '<x/>' })).toEqual({
      provider: 'fattura-elettronica-api',
      id: '5',
      status: 'queued',
      sdiFileName: 'IT01234567897_00001.xml',
    });
    expect(basic).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`);
    expect(bearer).toBe('Bearer bearer-1');
  });

  it('maps states, including ERRO with and without an SDI id', async () => {
    const pool = agent.get(HOST);
    pool
      .intercept({ path: '/ws2.0/test/authentication', method: 'POST' })
      .reply(200, { token: 't', expires: '2099-01-01 10:00:00' });
    pool.intercept({ path: '/ws2.0/test/fatture/5', method: 'GET' }).reply(200, {
      id: 5,
      sdi_identificativo: 123,
      sdi_stato: 'ERRO',
      sdi_messaggio: 'Scartata: 00404 Fattura duplicata',
    });
    const p = new FatturaElettronicaApiProvider({
      environment: 'test',
      credentials: { clientId: 'c', clientSecret: 's' },
      dispatcher: agent,
    });
    expect(await p.getStatus('5')).toMatchObject({
      status: 'rejected',
      sdiIdentifier: '123',
      errors: [{ description: 'Scartata: 00404 Fattura duplicata' }],
    });
    expect(mapFeaState('ERRO', null)).toBe('error');
    expect(mapFeaState('DECO')).toBe('deadline-expired');
  });

  it('reads the token expiry as Rome time', () => {
    expect(parseRomeLocalTime('2026-07-01 12:00:00')?.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(parseRomeLocalTime('2026-01-15 12:00:00')?.toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(parseRomeLocalTime('tomorrow')).toBeUndefined();
  });
});

describe('verifyFatturaElettronicaApiWebhook', () => {
  const token = 'k'.repeat(40);
  const body = JSON.stringify({
    event: 'fattura-aggiornamento',
    fattura: { id: 5, ricezione: 0, sdi_stato: 'CONS' },
  });
  it('accepts the configured token and a v2 payload', () => {
    expect(
      verifyFatturaElettronicaApiWebhook({ headers: { authorization: `Bearer ${token}` }, body }, { token }),
    ).toMatchObject({ event: 'fattura-aggiornamento', fattura: { id: 5 } });
  });
  it('rejects wrong tokens and legacy payloads', () => {
    expect(() =>
      verifyFatturaElettronicaApiWebhook({ headers: { authorization: 'Bearer nope' }, body }, { token }),
    ).toThrow(WebhookAuthenticationError);
    expect(() =>
      verifyFatturaElettronicaApiWebhook(
        { headers: { authorization: `Bearer ${token}` }, body: '[]' },
        { token },
      ),
    ).toThrow(/format v2/);
    expect(() => verifyFatturaElettronicaApiWebhook({ headers: {}, body }, { token: 'short' })).toThrow(
      RangeError,
    );
  });
});
