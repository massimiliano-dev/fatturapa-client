import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpClient,
  ReplayGuard,
  constantTimeEqual,
  hmacSha256Hex,
  TokenCache,
  verifyHttpMessageSignature,
  verifyStaticSecret,
  WebhookAuthenticationError,
} from '../src/index.js';

describe('TokenCache', () => {
  it('reuses a valid token, renews near expiry with refresh first, and shares one renewal', async () => {
    let now = 1_000_000;
    const login = vi.fn(async () => ({
      value: `login-${login.mock.calls.length}`,
      expiresAt: new Date(now + 600_000),
      refreshToken: 'r1',
    }));
    const refresh = vi.fn(async (r: string) => ({
      value: `refreshed-${r}`,
      expiresAt: new Date(now + 600_000),
    }));
    const cache = new TokenCache({ login, refresh, now: () => now });
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect([a, b]).toEqual(['login-1', 'login-1']);
    expect(login).toHaveBeenCalledTimes(1);
    now += 560_000; // inside the 60 s margin
    expect(await cache.get()).toBe('refreshed-r1');
    expect(refresh).toHaveBeenCalledTimes(1);
    cache.invalidate();
    expect(await cache.get()).toBe('login-2');
  });

  it('falls back to login when refresh fails and refuses invalid tokens', async () => {
    const cache = new TokenCache({
      login: async () => ({ value: 'ok', expiresAt: new Date(Date.now() + 600_000) }),
      refresh: async () => {
        throw new Error('nope');
      },
    });
    expect(await cache.get()).toBe('ok');
    const bad = new TokenCache({
      login: async () => ({ value: 'a\r\nb', expiresAt: new Date(Date.now() + 600_000) }),
    });
    await expect(bad.get()).rejects.toThrow(/invalid token/);
  });
});

describe('TokenCache under concurrent 401s', () => {
  it('keeps a token renewed meanwhile and renews with the refresh token', async () => {
    let n = 0;
    const login = vi.fn(async () => ({
      value: `T${++n}`,
      expiresAt: new Date(Date.now() + 600_000),
      refreshToken: 'r',
    }));
    const refresh = vi.fn(async () => ({
      value: `T${++n}`,
      expiresAt: new Date(Date.now() + 600_000),
      refreshToken: 'r',
    }));
    const cache = new TokenCache({ login, refresh });
    expect(await cache.get()).toBe('T1');
    cache.invalidate('T1'); // first 401
    expect(await cache.get()).toBe('T2');
    cache.invalidate('T1'); // second 401, for a request that was still using T1
    expect(await cache.get()).toBe('T2');
    expect(login).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('ReplayGuard', () => {
  it('drops ids seen within the TTL', () => {
    let now = 0;
    const guard = new ReplayGuard({ ttlSeconds: 10, now: () => now });
    expect(guard.firstSeen('a')).toBe(true);
    expect(guard.firstSeen('a')).toBe(false);
    now = 11_000;
    expect(guard.firstSeen('a')).toBe(true);
  });
});

describe('HttpClient paths', () => {
  it('refuses paths that the URL parser would normalise outside the base path', async () => {
    const http = new HttpClient({
      provider: 'x',
      baseUrl: 'https://api.example.com/api/v1',
      authorization: () => undefined,
    });
    for (const path of ['/%2e%2e/admin', '/a\\..\\admin', '/a/../b', '/a?x=1', '/a b']) {
      await expect(http.send({ method: 'GET', path, operation: 't' })).rejects.toThrow(
        /Invalid request path/,
      );
    }
    await http.close();
  });
});

describe('shared secrets and HMAC', () => {
  it('compares in constant time and checks static secrets', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    const secret = 's'.repeat(40);
    expect(() =>
      verifyStaticSecret({ authorization: secret }, { expected: secret, provider: 'x' }),
    ).not.toThrow();
    expect(() => verifyStaticSecret({ authorization: 'nope' }, { expected: secret, provider: 'x' })).toThrow(
      WebhookAuthenticationError,
    );
    expect(() =>
      verifyStaticSecret(
        { Authorization: secret, authorization: secret },
        { expected: secret, provider: 'x' },
      ),
    ).toThrow(WebhookAuthenticationError);
    expect(() => verifyStaticSecret({}, { expected: 'short', provider: 'x' })).toThrow(RangeError);
    expect(hmacSha256Hex('key', 'data')).toBe(
      '5031fe3d989c6d1537a013fa6e739da23463fdaec3b70137d828e36ace221bd0',
    );
  });
});

describe('verifyHttpMessageSignature (RFC 9421, Ed25519)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const url = 'https://hooks.example.com/acube?x=1';
  const body = JSON.stringify({ uuid: 'u-1' });
  const now = new Date('2026-05-20T10:00:00Z');
  const created = Math.floor(now.getTime() / 1000);
  const date = now.toUTCString();
  const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;

  function signed(
    overrides: { body?: string; params?: string; key?: typeof privateKey; method?: string } = {},
  ) {
    const params =
      overrides.params ??
      `("@method" "@authority" "@target-uri" "date" "content-digest");created=${created};keyid="acube";alg="ed25519"`;
    const base = [
      `"@method": POST`,
      `"@authority": hooks.example.com`,
      `"@target-uri": ${url}`,
      `"date": ${date}`,
      `"content-digest": ${digest}`,
      `"@signature-params": ${params}`,
    ].join('\n');
    const signature = sign(null, Buffer.from(base), overrides.key ?? privateKey).toString('base64');
    return {
      method: overrides.method ?? 'POST',
      headers: {
        'signature-input': `pyhms=${params}`,
        signature: `pyhms=:${signature}:`,
        date,
        'content-digest': digest,
      },
      body: overrides.body ?? body,
    };
  }
  const options = {
    provider: 'acube',
    keys: { acube: publicKey },
    url,
    requiredComponents: ['@method', '@target-uri', 'content-digest'],
    now,
  };

  it('accepts a valid signature', () => {
    expect(verifyHttpMessageSignature(signed(), options)).toBe('pyhms');
  });

  it('rejects tampering, wrong keys, replays and missing coverage', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(() => verifyHttpMessageSignature(signed({ body: '{"uuid":"u-2"}' }), options)).toThrow(
      /content-digest/,
    );
    expect(() => verifyHttpMessageSignature(signed({ key: other }), options)).toThrow(/invalid/);
    expect(() => verifyHttpMessageSignature(signed({ method: 'PUT' }), options)).toThrow(/invalid/);
    expect(() =>
      verifyHttpMessageSignature(signed(), { ...options, url: 'https://evil.example/acube?x=1' }),
    ).toThrow(/invalid/);
    expect(() =>
      verifyHttpMessageSignature(signed(), { ...options, now: new Date(now.getTime() + 3600_000) }),
    ).toThrow(/too old/);
    expect(() =>
      verifyHttpMessageSignature(
        signed({
          params: `("@method" "@authority" "@target-uri" "date" "content-digest");created=${created};keyid="other";alg="ed25519"`,
        }),
        options,
      ),
    ).toThrow(/no acceptable signature/);
    expect(() => verifyHttpMessageSignature({ method: 'POST', headers: {}, body }, options)).toThrow(
      /not signed/,
    );
    expect(() =>
      verifyHttpMessageSignature(signed(), { ...options, requiredComponents: ['@method', 'x-extra'] }),
    ).toThrow(/no acceptable/);
  });
});
