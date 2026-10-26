import {
  buildFatturaXml,
  FatturaPAError,
  HttpClient,
  pathSegment,
  ProviderError,
  providerErrorFor,
  redact,
  TokenCache,
  type CallOptions,
  type HttpResponse,
  type InvoiceStatusResult,
  type ProviderCapabilities,
  type SdiProvider,
  type SdiStatus,
  type SendInvoiceInput,
  type SendResult,
} from '@massimiliano-dev/fatturapa-core';
import type { Dispatcher } from 'undici';
import { z } from 'zod';
import { authResponse, fattura, sendResponse, type FeaFattura } from './schemas.js';

/** `servers` of the OpenAPI document. */
export const FEA_HOSTS = {
  test: 'https://fattura-elettronica-api.it/ws2.0/test',
  production: 'https://fattura-elettronica-api.it/ws2.0/prod',
} as const;
export type FeaEnvironment = keyof typeof FEA_HOSTS;

export interface FatturaElettronicaApiProviderOptions {
  environment: FeaEnvironment;
  /** `client_id` / `client_secret` from the reserved area ("scheda personale"). */
  credentials:
    { clientId: string; clientSecret: string } | (() => Promise<{ clientId: string; clientSecret: string }>);
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

/**
 * Maps `sdi_stato`. `ERRO` covers both provider errors and SDI rejections ("vedere sdi_messaggio"): with an
 * SDI identifier it is treated as a rejection, otherwise as an error. TODO(verify) against real NS cases.
 */
export function mapFeaState(state: string | null | undefined, sdiIdentifier?: number | null): SdiStatus {
  switch (state) {
    case 'PREN':
      return 'queued';
    case 'INVI':
      return 'sent';
    case 'ERRO':
      return sdiIdentifier ? 'rejected' : 'error';
    case 'CONS':
      return 'delivered';
    case 'NONC':
      return 'not-delivered';
    case 'ACCE':
      return 'accepted';
    case 'RIFI':
      return 'refused';
    case 'DECO':
      return 'deadline-expired';
    default:
      return 'unknown';
  }
}

/**
 * Parses the `expires` of `/authentication` (`yyyy-mm-dd hh:mm:ss`, no zone). The service is Italian,
 * so the value is read as Europe/Rome local time. TODO(verify).
 */
export function parseRomeLocalTime(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  const offsetFor = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Rome',
      timeZoneName: 'longOffset',
    }).formatToParts(new Date(t));
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00';
    const o = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
    return o ? (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])) * 60_000 : 3_600_000;
  };
  return new Date(asUtc - offsetFor(asUtc - offsetFor(asUtc)));
}

/**
 * Fattura Elettronica API (https://www.fattura-elettronica-api.it/documentazione2.0/). Sends FatturaPA XML;
 * the provider rewrites `DatiTrasmissione` (it is the transmitter). Authentication: Basic
 * client_id:client_secret exchanged for a Bearer token, cached and renewed.
 */
export class FatturaElettronicaApiProvider implements SdiProvider {
  readonly name = 'fattura-elettronica-api';
  readonly capabilities: ProviderCapabilities = {
    sendXml: true,
    sendModel: true,
    signature: true,
    receive: true,
    notifications: true,
    webhooks: true,
    sandbox: true,
  };
  readonly #http: HttpClient;
  readonly #tokens: TokenCache;

  constructor(options: FatturaElettronicaApiProviderOptions) {
    if (!(options.environment in FEA_HOSTS))
      throw new RangeError('environment must be "test" or "production"');
    const baseUrl = FEA_HOSTS[options.environment];
    const credentials = options.credentials;
    const dispatcher = options.dispatcher;
    this.#tokens = new TokenCache({
      login: async () => {
        const { clientId, clientSecret } =
          typeof credentials === 'function' ? await credentials() : credentials;
        if (!clientId || !clientSecret || clientId.includes(':'))
          throw new FatturaPAError('fattura-elettronica-api: invalid credentials');
        const http = new HttpClient({
          provider: this.name,
          baseUrl,
          authorization: () => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          maxRetries: 0,
          ...(dispatcher ? { dispatcher } : {}),
        });
        try {
          const response = await http.send({
            method: 'POST',
            path: '/authentication',
            operation: 'authentication',
          });
          if (response.status !== 200) throw providerErrorFor(this.name, 'authentication', response);
          const parsed = authResponse.safeParse(response.json());
          if (!parsed.success)
            throw new ProviderError('fattura-elettronica-api: unexpected authentication response', {
              provider: this.name,
              operation: 'authentication',
              status: 200,
            });
          return {
            value: parsed.data.token,
            expiresAt: parseRomeLocalTime(parsed.data.expires) ?? new Date(Date.now() + 10 * 60_000),
          };
        } finally {
          await http.close();
        }
      },
    });
    const tokens = this.#tokens;
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl,
      authorization: async () => `Bearer ${await tokens.get()}`,
      onUnauthorized: (rejected) => tokens.invalidate(rejected?.replace(/^Bearer /, '')),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
      ...(dispatcher === undefined ? {} : { dispatcher }),
      userAgent: 'fatturapa-client (+https://github.com/massimiliano-dev/fatturapa-client)',
    });
  }

  #parse<T extends z.ZodTypeAny>(schema: T, response: HttpResponse, operation: string): z.infer<T> {
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, operation, response);
    const parsed = schema.safeParse(response.json());
    if (!parsed.success) {
      throw new ProviderError(
        `fattura-elettronica-api: unexpected ${operation} response (HTTP ${response.status})`,
        { provider: this.name, operation, status: response.status },
      );
    }
    return parsed.data;
  }

  /** Sends an XML invoice. Never retried. An `ERRO` answer is returned as status `error` with the message. */
  async send(
    input: SendInvoiceInput,
    options: CallOptions = {},
  ): Promise<SendResult & { message?: string; sdiFileName?: string }> {
    if ((input.xml === undefined) === (input.invoice === undefined))
      throw new RangeError('Pass exactly one of xml and invoice');
    const xml = input.xml ?? buildFatturaXml(input.invoice!);
    const response = await this.#http.send({
      method: 'POST',
      path: '/fatture',
      body: xml,
      contentType: 'application/xml',
      operation: 'send',
      ...sig(options),
    });
    const r = this.#parse(sendResponse, response, 'send');
    return {
      provider: this.name,
      id: String(r.id),
      status: mapFeaState(r.sdi_stato, r.sdi_identificativo),
      ...(r.sdi_messaggio ? { message: redact(r.sdi_messaggio).slice(0, 1000) } : {}),
      ...(r.sdi_nome_file ? { sdiFileName: r.sdi_nome_file } : {}),
    };
  }

  async getFattura(id: string | number, options: CallOptions = {}): Promise<FeaFattura> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/fatture/${pathSegment(numericId(id))}`,
      operation: 'getFattura',
      ...sig(options),
    });
    const body = response.json();
    // The endpoint may return the object or a one-element list.
    const schema = z.union([
      fattura,
      z
        .array(fattura)
        .length(1)
        .transform((a) => a[0]!),
    ]);
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'getFattura', response);
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ProviderError('fattura-elettronica-api: unexpected getFattura response', {
        provider: this.name,
        operation: 'getFattura',
        status: response.status,
      });
    return parsed.data;
  }

  async getStatus(id: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    const f = await this.getFattura(id, options);
    const status = mapFeaState(f.sdi_stato, f.sdi_identificativo);
    const result: InvoiceStatusResult = { provider: this.name, id: String(f.id), status };
    if (f.sdi_stato) result.providerStatus = f.sdi_stato;
    if (f.sdi_identificativo) result.sdiIdentifier = String(f.sdi_identificativo);
    if (f.sdi_nome_file) result.sdiFileName = f.sdi_nome_file;
    if (f.sdi_messaggio && (status === 'rejected' || status === 'error' || status === 'refused')) {
      result.errors = [{ description: redact(f.sdi_messaggio).slice(0, 1000) }];
    }
    return result;
  }

  /**
   * Received invoices (`ricezione: 1`) and transmission updates (`ricezione: 0`), up to 1000 per page.
   * Use `unread: true` to poll incrementally.
   */
  async listFatture(
    query: {
      unread?: boolean;
      solo_ricezioni?: boolean;
      solo_trasmissioni?: boolean;
      date_from?: string;
      date_to?: string;
      partita_iva?: string;
      per_page?: number;
      page?: number;
    } = {},
    options: CallOptions = {},
  ): Promise<FeaFattura[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/fatture',
      query,
      operation: 'listFatture',
      ...sig(options),
    });
    return this.#parse(z.array(fattura).max(1000), response, 'listFatture');
  }

  /** The original SDI notification XML of a transmission (parse it with `parseSdiNotification`). */
  async getNotificationXml(id: string | number, options: CallOptions = {}): Promise<Uint8Array> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/fatture/${pathSegment(numericId(id))}/notifica`,
      accept: 'application/xml',
      operation: 'getNotificationXml',
      ...sig(options),
    });
    if (response.status !== 200) throw providerErrorFor(this.name, 'getNotificationXml', response);
    return new Uint8Array(response.body);
  }

  async getPdf(id: string | number, options: CallOptions = {}): Promise<Uint8Array> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/fatture/${pathSegment(numericId(id))}/pdf`,
      accept: 'application/pdf',
      operation: 'getPdf',
      ...sig(options),
    });
    if (response.status !== 200) throw providerErrorFor(this.name, 'getPdf', response);
    return new Uint8Array(response.body);
  }

  async close(): Promise<void> {
    await this.#http.close();
  }
}

function numericId(id: string | number): string {
  const text = String(id);
  if (!/^\d{1,18}$/.test(text)) throw new RangeError('id must be numeric');
  return text;
}

function sig(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
