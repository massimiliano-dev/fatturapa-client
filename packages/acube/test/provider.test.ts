import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFatturaXml, computeTotals, WebhookAuthenticationError } from '@massimiliano-dev/fatturapa-core';
import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import { createPublicKey } from 'node:crypto';
import {
  ACUBE_WEBHOOK_PUBLIC_KEYS,
  AcubeProvider,
  mapAcubeMarking,
  verifyAcubeWebhook,
} from '../src/index.js';

let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});

function jwt(expSeconds: number): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc({ exp: expSeconds })}.c2ln`;
}

describe('AcubeProvider', () => {
  it('logs in once, sends XML and reads the status', async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 86_400);
    let loginBody: unknown;
    agent
      .get('https://common.api.acubeapi.com')
      .intercept({ path: '/login', method: 'POST' })
      .reply((opts) => {
        loginBody = JSON.parse(String(opts.body));
        return { statusCode: 200, data: { token } };
      });
    const api = agent.get('https://api-sandbox.acubeapi.com');
    let auth: string | undefined;
    api.intercept({ path: '/invoices', method: 'POST' }).reply((opts) => {
      auth = (opts.headers as Record<string, string>).authorization;
      return { statusCode: 202, data: { uuid: 'a-1' } };
    });
    api.intercept({ path: '/invoices/a-1', method: 'GET' }).reply(200, {
      uuid: 'a-1',
      marking: 'delivered',
      sdi_file_id: '77',
      sdi_file_name: 'IT01234567897_00001.xml',
    });
    const p = new AcubeProvider({
      environment: 'sandbox',
      credentials: { email: 'dev@example.com', password: 'pw' },
      dispatcher: agent,
    });
    expect(await p.send({ xml: buildFatturaXml(computeTotals(syntheticInvoice())) })).toEqual({
      provider: 'acube',
      id: 'a-1',
      status: 'queued',
    });
    expect(await p.getStatus('a-1')).toMatchObject({ status: 'delivered', sdiIdentifier: '77' });
    expect(loginBody).toEqual({ email: 'dev@example.com', password: 'pw', environment: 'sandbox' });
    expect(auth).toBe(`Bearer ${token}`);
  });

  it('re-authenticates once on 401', async () => {
    const login = agent.get('https://common.api.acubeapi.com');
    login
      .intercept({ path: '/login', method: 'POST' })
      .reply(200, { token: jwt(Math.floor(Date.now() / 1000) + 86_400) })
      .times(2);
    const api = agent.get('https://api-sandbox.acubeapi.com');
    api.intercept({ path: '/invoices/a-1', method: 'GET' }).reply(401, { message: 'Expired JWT Token' });
    api.intercept({ path: '/invoices/a-1', method: 'GET' }).reply(200, { uuid: 'a-1', marking: 'waiting' });
    const p = new AcubeProvider({
      environment: 'sandbox',
      credentials: { email: 'e@example.com', password: 'p' },
      dispatcher: agent,
    });
    expect((await p.getStatus('a-1')).status).toBe('queued');
  });

  it('validates configuration', async () => {
    expect(() => new AcubeProvider({ environment: 'sandbox' })).toThrow(/exactly one/);
    const p = new AcubeProvider({ environment: 'sandbox', token: () => 't', dispatcher: agent });
    await expect(
      p.createWebhook({ event: 'customer-notification', url: 'http://x.example/h' }),
    ).rejects.toThrow(/https/);
    await expect(
      p.createWebhook({
        event: 'customer-notification',
        url: 'https://x.example/h',
        authenticationToken: 'short',
      }),
    ).rejects.toThrow(/32/);
    expect(mapAcubeMarking('quarantena')).toBe('queued');
    expect(mapAcubeMarking('invoice-error')).toBe('error');
  });

  it('ships the published Ed25519 keys', () => {
    for (const pem of Object.values(ACUBE_WEBHOOK_PUBLIC_KEYS))
      expect(createPublicKey(pem).asymmetricKeyType).toBe('ed25519');
  });
});

describe('verifyAcubeWebhook', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const url = 'https://hooks.example.com/acube/customer-notification';
  const now = new Date('2026-05-20T10:00:00Z');
  const body = JSON.stringify({ uuid: 'a-1', marking: 'delivered' });

  function request(b = body) {
    const created = Math.floor(now.getTime() / 1000);
    const date = now.toUTCString();
    const digest = `sha-256=:${createHash('sha256').update(b).digest('base64')}:`;
    const params = `("@method" "@authority" "@target-uri" "date" "content-digest");created=${created};keyid="acube";alg="ed25519"`;
    const base = [
      `"@method": POST`,
      `"@authority": hooks.example.com`,
      `"@target-uri": ${url}`,
      `"date": ${date}`,
      `"content-digest": ${digest}`,
      `"@signature-params": ${params}`,
    ].join('\n');
    const signature = sign(null, Buffer.from(base), privateKey).toString('base64');
    return {
      method: 'POST',
      headers: {
        signature: `pyhms=:${signature}:`,
        'signature-input': `pyhms=${params}`,
        date,
        'content-digest': digest,
        authorization: 'Bearer ' + 't'.repeat(40),
      },
      body,
    };
  }

  it('verifies the signature and returns the payload', () => {
    expect(
      verifyAcubeWebhook(request(), {
        environment: 'sandbox',
        url,
        publicKey,
        now,
        expectedAuthorization: 'Bearer ' + 't'.repeat(40),
      }),
    ).toEqual({ uuid: 'a-1', marking: 'delivered' });
  });

  it('rejects calls not signed by A-Cube', () => {
    expect(() => verifyAcubeWebhook(request(), { environment: 'sandbox', url, now })).toThrow(
      WebhookAuthenticationError,
    ); // published key, test signature
    const tampered = { ...request(), body: body.replace('delivered', 'rejected') };
    expect(() => verifyAcubeWebhook(tampered, { environment: 'sandbox', url, publicKey, now })).toThrow(
      /content-digest/,
    );
    expect(() =>
      verifyAcubeWebhook(request(), {
        environment: 'sandbox',
        url,
        publicKey,
        now,
        expectedAuthorization: 'Bearer ' + 'u'.repeat(40),
      }),
    ).toThrow(/secret/);
  });
});
