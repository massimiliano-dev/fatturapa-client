import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderValidationError } from '@massimiliano-dev/fatturapa-core';
import { KeliwebProvider, mapKeliwebStatus } from '../src/index.js';

const HOST = 'https://fatture.keliweb.it';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});
const credentials = { clientId: 'cid', clientSecret: 'sec', username: 'dev@example.com', password: 'pw' };

describe('KeliwebProvider', () => {
  it('uses the password grant and sends the XML as a multipart field', async () => {
    const pool = agent.get(HOST);
    let tokenBody = '';
    let sent = '';
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply((opts) => {
      tokenBody = String(opts.body);
      return {
        statusCode: 200,
        data: { token_type: 'Bearer', expires_in: 3600, access_token: 'at', refresh_token: 'rt' },
      };
    });
    pool.intercept({ path: '/api/send-xml', method: 'POST' }).reply((opts) => {
      sent = Buffer.from(opts.body as Uint8Array).toString('utf8');
      return {
        statusCode: 200,
        data: {
          status: 'success',
          message: 'Fattura creata',
          invoiceData: { invoiceId: 15, status: 'INVIATA' },
          sdi: { IdentificativoSdI: 25704431 },
        },
      };
    });
    const p = new KeliwebProvider({ credentials, dispatcher: agent });
    expect(await p.send({ xml: '<x>a&amp;b</x>' })).toEqual({
      provider: 'keliweb',
      id: '15',
      status: 'sent',
    });
    expect(tokenBody).toBe(
      'grant_type=password&client_id=cid&client_secret=sec&username=dev%40example.com&password=pw',
    );
    expect(sent).toContain('Content-Disposition: form-data; name="xml"\r\n\r\n<x>a&amp;b</x>\r\n');
  });

  it('reports refusals and maps the status', async () => {
    const pool = agent.get(HOST);
    pool
      .intercept({ path: '/oauth/token', method: 'POST' })
      .reply(200, { expires_in: 3600, access_token: 'at' });
    pool
      .intercept({ path: '/api/send-xml', method: 'POST' })
      .reply(200, { status: 'errors', message: 'XML non valido' });
    pool.intercept({ path: '/api/get-invoice-info', method: 'POST' }).reply(200, {
      data: { invoice: { id: 15, status: 'INVIATA', identificativoSdI: 25702397, notifications: [] } },
    });
    const p = new KeliwebProvider({ credentials, dispatcher: agent });
    await expect(p.send({ xml: '<x/>' })).rejects.toBeInstanceOf(ProviderValidationError);
    expect(await p.getStatus('15')).toEqual({
      provider: 'keliweb',
      id: '15',
      status: 'sent',
      providerStatus: 'INVIATA',
      sdiIdentifier: '25702397',
    });
    expect(mapKeliwebStatus('presa in carico')).toBe('queued');
    expect(mapKeliwebStatus('XYZ')).toBe('unknown');
    await expect(p.getStatus('1 OR 1=1')).rejects.toThrow(RangeError);
  });
});
