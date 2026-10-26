import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { bodyBytes, singleHeader, WebhookAuthenticationError } from './secrets.js';

/** Options of {@link verifyHttpMessageSignature}. */
export interface HttpMessageSignatureOptions {
  /** Provider name for error messages. */
  provider: string;
  /** Public keys by `keyid`. Only Ed25519 keys are accepted. */
  keys: Record<string, string | KeyObject>;
  /** The full URL the request was sent to, as configured at the provider (behind proxies the request line differs). */
  url: string;
  /** Components that must be covered by the signature. */
  requiredComponents: readonly string[];
  /** Maximum age of the `created` parameter, in seconds. Default 300. */
  maxAgeSeconds?: number;
  /** Clock, for tests. */
  now?: Date;
}

export interface SignedRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string | Uint8Array;
}

const DICT_MEMBER = /\s*([a-z*][a-z0-9_.*-]*)=/y;

/** Parses an RFC 8941 dictionary of the shape used by Signature and Signature-Input (one level). */
function parseDictionary(value: string): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  while (pos < value.length) {
    DICT_MEMBER.lastIndex = pos;
    const m = DICT_MEMBER.exec(value);
    if (!m) throw new Error('bad dictionary');
    pos = DICT_MEMBER.lastIndex;
    let depth = 0;
    let inString = false;
    const start = pos;
    for (; pos < value.length; pos += 1) {
      const ch = value[pos];
      if (inString) {
        if (ch === '\\') pos += 1;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) break;
    }
    out.set(m[1]!, value.slice(start, pos).trim());
    pos += 1;
  }
  return out;
}

/**
 * Verifies an HTTP Message Signature (RFC 9421) made with Ed25519, for the components providers use:
 * `@method`, `@authority`, `@target-uri`, `@path`, `@query` and plain header fields; when `content-digest`
 * is covered, the body digest (RFC 9530, sha-256 or sha-512) is checked too. The `alg` and `keyid`
 * parameters must name an accepted Ed25519 key; `created` must be recent.
 *
 * Returns the label of the verified signature.
 *
 * @throws {WebhookAuthenticationError} on any failure.
 */
export function verifyHttpMessageSignature(
  request: SignedRequest,
  options: HttpMessageSignatureOptions,
): string {
  const fail = (why: string): never => {
    throw new WebhookAuthenticationError(`${options.provider}: ${why}`);
  };
  const sigHeader = singleHeader(request.headers, 'signature');
  const inputHeader = singleHeader(request.headers, 'signature-input');
  if (!sigHeader || !inputHeader) fail('request is not signed');
  if (sigHeader!.length > 8192 || inputHeader!.length > 8192) fail('signature headers too long');
  let signatures: Map<string, string>;
  let inputs: Map<string, string>;
  try {
    signatures = parseDictionary(sigHeader!);
    inputs = parseDictionary(inputHeader!);
  } catch {
    return fail('signature headers are malformed');
  }
  const url = new URL(options.url);
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const maxAge = options.maxAgeSeconds ?? 300;

  for (const [label, params] of inputs) {
    const sig = /^:([A-Za-z0-9+/]+={0,2}):$/.exec(signatures.get(label) ?? '');
    const list = /^\(([^)]*)\)((?:;[a-z]+=(?:"[^"]*"|-?\d+))*)$/.exec(params);
    if (!sig || !list) continue;
    const components = [...list[1]!.matchAll(/"([^"]+)"/g)].map((c) => c[1]!.toLowerCase());
    const parameters = new Map(
      [...list[2]!.matchAll(/;([a-z]+)=("([^"]*)"|-?\d+)/g)].map((p) => [p[1]!, p[3] ?? p[2]!]),
    );
    if (!options.requiredComponents.every((c) => components.includes(c.toLowerCase()))) continue;
    const alg = parameters.get('alg');
    if (alg !== undefined && alg !== 'ed25519') continue;
    const keyId = parameters.get('keyid');
    const keySource =
      keyId !== undefined && Object.hasOwn(options.keys, keyId) ? options.keys[keyId] : undefined;
    if (!keySource) continue;
    const key = typeof keySource === 'string' ? createPublicKey(keySource) : keySource;
    if (key.asymmetricKeyType !== 'ed25519') fail('only Ed25519 keys are accepted');
    const created = Number(parameters.get('created'));
    if (!Number.isFinite(created) || created > now + 60 || now - created > maxAge)
      fail('signature is too old or from the future');
    const expires = parameters.get('expires');
    if (expires !== undefined && Number(expires) < now) fail('signature expired');

    const lines: string[] = [];
    for (const component of components) {
      let value: string | undefined;
      switch (component) {
        case '@method':
          value = request.method.toUpperCase();
          break;
        case '@authority':
          value = url.host.toLowerCase();
          break;
        case '@target-uri':
          value = url.href;
          break;
        case '@path':
          value = url.pathname;
          break;
        case '@query':
          value = url.search === '' ? '?' : url.search;
          break;
        default:
          if (component.startsWith('@')) fail(`unsupported signature component ${component}`);
          value = singleHeader(request.headers, component)?.trim().replace(/\s+/g, ' ');
      }
      if (value === undefined) fail(`signed component ${component} is missing`);
      lines.push(`"${component}": ${value}`);
    }
    lines.push(`"@signature-params": ${params}`);
    const ok = verify(null, Buffer.from(lines.join('\n')), key, Buffer.from(sig[1]!, 'base64'));
    if (!ok) fail('signature is invalid');

    if (components.includes('content-digest')) {
      const digest = singleHeader(request.headers, 'content-digest') ?? '';
      const body = bodyBytes(request.body);
      const entries = [...digest.matchAll(/(sha-256|sha-512)=:([A-Za-z0-9+/]+={0,2}):/g)];
      if (entries.length === 0) fail('content-digest has no supported algorithm');
      for (const [, algorithm, value] of entries) {
        const actual = createHash(algorithm === 'sha-256' ? 'sha256' : 'sha512')
          .update(body)
          .digest('base64');
        if (actual !== value) fail('body does not match content-digest');
      }
    }
    return label;
  }
  return fail('no acceptable signature (key, algorithm or covered components)');
}
