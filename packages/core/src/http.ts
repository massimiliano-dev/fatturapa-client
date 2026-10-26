import { Agent, request, type Dispatcher } from 'undici';
import { FatturaPAError } from './errors.js';
import { redact } from './redact.js';

/** Base class of errors returned by a provider's HTTP API. */
export class ProviderError extends FatturaPAError {
  constructor(
    message: string,
    readonly details: {
      provider: string;
      operation: string;
      status?: number;
      /** Redacted, bounded messages extracted from the provider's error body. */
      messages?: string[];
    },
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  override toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message, ...this.details };
  }
}

/** 401/403: the token is missing, expired, revoked or lacks a scope. */
export class ProviderAuthError extends ProviderError {}
/** 400/409/422: the provider refused the content of the request. */
export class ProviderValidationError extends ProviderError {}
/** 404. */
export class ProviderNotFoundError extends ProviderError {}
/** 402: credit exhausted or plan limit reached. */
export class ProviderPaymentRequiredError extends ProviderError {}
/** 429 (or a provider-specific quota error): retry after `retryAfterSeconds` if given. */
export class ProviderRateLimitError extends ProviderError {
  retryAfterSeconds?: number;
}
/** No usable HTTP response: DNS, TCP, TLS (including certificate verification), timeouts, oversized body. */
export class ProviderTransportError extends ProviderError {}

/** Options of {@link HttpClient}. */
export interface HttpClientOptions {
  /** Provider name used in errors. */
  provider: string;
  /** HTTPS base URL, e.g. `https://api-v2.fattureincloud.it`. Plain HTTP is refused. */
  baseUrl: string;
  /**
   * Returns the value of the `Authorization` header, e.g. `Bearer …`, or `undefined` for endpoints that
   * authenticate otherwise. Called for every request; a value containing CR/LF is refused.
   */
  authorization: () => string | undefined | Promise<string | undefined>;
  /** Timeout for connect, headers and body, in milliseconds. Default 30 s. */
  timeoutMs?: number;
  /** Maximum response body size. Default 10 MiB. */
  maxResponseBytes?: number;
  /** Retries of idempotent GET requests on 429/502/503/504, honouring Retry-After. Default 2, max 5. */
  maxRetries?: number;
  /** Upper bound of a single wait between retries, in seconds. Default 30. */
  maxRetryWaitSeconds?: number;
  /** undici dispatcher, e.g. a `MockAgent` in tests or a proxy agent. Default: a private `Agent`. */
  dispatcher?: Dispatcher;
  /** `User-Agent` header. */
  userAgent?: string;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path segments are encoded by the caller with {@link pathSegment}. */
  path: string;
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  json?: unknown;
  body?: string | Uint8Array;
  contentType?: string;
  accept?: string;
  headers?: Record<string, string>;
  operation: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text(): string;
  json(): unknown;
}

/** Encodes one path segment, refusing empty values and dot segments. */
export function pathSegment(value: string | number): string {
  const text = String(value);
  if (text === '' || text === '.' || text === '..') throw new RangeError('Invalid path segment');
  return encodeURIComponent(text);
}

/** Validates an HTTPS base URL without credentials, query or fragment. */
export function assertHttpsBaseUrl(value: string, label = 'baseUrl'): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError(`${label} is not a valid URL`);
  }
  if (url.protocol !== 'https:') throw new RangeError(`${label} must use https`);
  if (url.username || url.password) throw new RangeError(`${label} must not contain credentials`);
  if (url.search || url.hash) throw new RangeError(`${label} must not contain a query or fragment`);
  return url;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Parses Retry-After (seconds or HTTP date) into seconds. */
export function retryAfterSeconds(value: string | string[] | undefined): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined) return undefined;
  if (/^\d+$/.test(text.trim())) return Number(text.trim());
  const date = Date.parse(text);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Minimal hardened HTTP client shared by provider adapters:
 * - HTTPS only; certificate verification always on (undici default, never disabled here);
 * - redirects are never followed (undici's `request` does not follow them; a redirect could carry the
 *   bearer token to another host) and surface as a {@link ProviderError};
 * - connect/headers/body timeouts and a response size cap;
 * - automatic retries only for idempotent GETs;
 * - the token is never logged or put into errors; error bodies are redacted and truncated.
 */
export class HttpClient {
  readonly #options: Required<Omit<HttpClientOptions, 'dispatcher' | 'userAgent'>> & { userAgent?: string };
  readonly #base: URL;
  readonly #dispatcher: Dispatcher;
  readonly #ownsDispatcher: boolean;

  constructor(options: HttpClientOptions) {
    this.#base = assertHttpsBaseUrl(options.baseUrl);
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
      throw new RangeError('timeoutMs must be a positive integer');
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5)
      throw new RangeError('maxRetries must be 0..5');
    this.#options = {
      provider: options.provider,
      baseUrl: options.baseUrl,
      authorization: options.authorization,
      timeoutMs,
      maxResponseBytes: options.maxResponseBytes ?? 10 * 1024 * 1024,
      maxRetries,
      maxRetryWaitSeconds: options.maxRetryWaitSeconds ?? 30,
      ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    };
    this.#ownsDispatcher = options.dispatcher === undefined;
    this.#dispatcher =
      options.dispatcher ??
      new Agent({
        connect: { timeout: timeoutMs, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
  }

  /** Base URL of this client (origin + base path). */
  get baseUrl(): string {
    return this.#base.href;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    const attempts = req.method === 'GET' ? this.#options.maxRetries + 1 : 1;
    let last: HttpResponse | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      last = await this.#once(req);
      if (!RETRYABLE.has(last.status) || attempt === attempts) return last;
      const wait = retryAfterSeconds(last.headers['retry-after']) ?? 2 ** attempt;
      if (wait > this.#options.maxRetryWaitSeconds) return last;
      await sleep(wait * 1000, req.signal);
    }
    return last!;
  }

  async #once(req: HttpRequest): Promise<HttpResponse> {
    const basePath = this.#base.pathname.replace(/\/$/, '');
    if (!req.path.startsWith('/') || req.path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(req.path)) {
      throw new RangeError('Invalid request path');
    }
    const url = new URL(`${basePath}${req.path}`, this.#base.origin);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, v);
      else url.searchParams.set(key, String(value));
    }
    if (url.origin !== this.#base.origin) throw new RangeError('Request would leave the configured origin');

    const authorization = await this.#options.authorization();
    if (authorization !== undefined && /[\r\n]/.test(authorization))
      throw new RangeError('Invalid authorization header value');
    const headers: Record<string, string> = {
      accept: req.accept ?? 'application/json',
      ...(authorization ? { authorization } : {}),
      ...(this.#options.userAgent ? { 'user-agent': this.#options.userAgent } : {}),
      ...req.headers,
    };
    let body: string | Uint8Array | undefined;
    if (req.json !== undefined) {
      body = JSON.stringify(req.json);
      headers['content-type'] = 'application/json';
    } else if (req.body !== undefined) {
      body = req.body;
      headers['content-type'] = req.contentType ?? 'application/octet-stream';
    }

    let response: Dispatcher.ResponseData;
    try {
      response = await request(url, {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body }),
        dispatcher: this.#dispatcher,
        headersTimeout: this.#options.timeoutMs,
        bodyTimeout: this.#options.timeoutMs,
        ...(req.signal ? { signal: req.signal } : {}),
      });
    } catch (error) {
      throw new ProviderTransportError(
        `${this.#options.provider}: ${req.operation} failed before a response was received`,
        { provider: this.#options.provider, operation: req.operation },
        { cause: error },
      );
    }

    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buf.byteLength;
        if (size > this.#options.maxResponseBytes) {
          response.body.destroy();
          throw new RangeError('too large');
        }
        chunks.push(buf);
      }
    } catch (error) {
      throw new ProviderTransportError(
        `${this.#options.provider}: ${req.operation} response body could not be read (or exceeds ${this.#options.maxResponseBytes} bytes)`,
        { provider: this.#options.provider, operation: req.operation, status: response.statusCode },
        { cause: error },
      );
    }
    const buffer = Buffer.concat(chunks, size);
    return {
      status: response.statusCode,
      headers: response.headers,
      body: buffer,
      text: () => buffer.toString('utf8'),
      json: () => {
        try {
          return buffer.byteLength === 0 ? undefined : (JSON.parse(buffer.toString('utf8')) as unknown);
        } catch {
          return undefined;
        }
      },
    };
  }

  async close(): Promise<void> {
    if (this.#ownsDispatcher) await this.#dispatcher.close();
  }
}

/** Collects up to 20 redacted strings (each at most 500 characters) from an error body. */
export function errorMessages(
  body: unknown,
  keys: readonly string[] = ['message', 'error', 'detail', 'title', 'description', 'errors'],
): string[] {
  const out: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (out.length >= 20 || depth > 5 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.trim() !== '') out.push(redact(value).slice(0, 500));
      return;
    }
    if (Array.isArray(value)) return value.forEach((v) => visit(v, depth + 1));
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) if (keys.includes(k) || depth > 0) visit(v, depth + 1);
    }
  };
  visit(body, 0);
  return out;
}

/** Maps a non-success HTTP status to the matching {@link ProviderError} subclass. */
export function providerErrorFor(provider: string, operation: string, response: HttpResponse): ProviderError {
  const status = response.status;
  const messages = errorMessages(response.json());
  const suffix = messages.length > 0 ? `: ${messages.slice(0, 3).join('; ')}` : '';
  const details = { provider, operation, status, messages };
  const text = `${provider}: ${operation} failed (HTTP ${status})${suffix}`;
  if (status === 401 || status === 403) return new ProviderAuthError(text, details);
  if (status === 402) return new ProviderPaymentRequiredError(text, details);
  if (status === 404) return new ProviderNotFoundError(text, details);
  if (status === 429) {
    const err = new ProviderRateLimitError(text, details);
    const wait = retryAfterSeconds(response.headers['retry-after']);
    if (wait !== undefined) err.retryAfterSeconds = wait;
    return err;
  }
  if (status === 400 || status === 409 || status === 422) return new ProviderValidationError(text, details);
  return new ProviderError(text, details);
}
