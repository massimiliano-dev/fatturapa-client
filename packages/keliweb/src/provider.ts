import { randomBytes } from 'node:crypto';
import {
  buildFatturaXml,
  FatturaPAError,
  HttpClient,
  ProviderError,
  providerErrorFor,
  ProviderValidationError,
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

/** The only documented host (no test environment is documented). */
export const KELIWEB_BASE_URL = 'https://fatture.keliweb.it';

const s = (max = 1000) => z.string().max(max).nullish();
const num = z.union([
  z.number(),
  z
    .string()
    .regex(/^\d{1,18}$/)
    .transform(Number),
]);

const tokenResponse = z.object({
  access_token: z.string().min(1).max(16_384),
  refresh_token: z.string().max(16_384).nullish(),
  expires_in: z
    .number()
    .int()
    .positive()
    .max(30 * 86_400),
});

const sendResponse = z.object({
  status: z.string().max(20),
  message: s(10_000),
  invoiceData: z
    .object({ invoiceId: num.nullish(), filename: s(200), status: s(100) })
    .passthrough()
    .nullish(),
  sdi: z
    .object({ IdentificativoSdI: num.nullish(), DataOraRicezione: s(50) })
    .passthrough()
    .nullish(),
});

const notification = z
  .object({
    id: num,
    invoice_id: num.nullish(),
    identificativoSdI: num.nullish(),
    nomeFileNotifica: s(200),
    type: s(10),
    errors: z.unknown().optional(),
    esito: s(20),
    descrizione: s(10_000),
    dataOraRicezione: s(50),
  })
  .passthrough();
export type KeliwebNotification = z.infer<typeof notification>;

const invoiceInfo = z.object({
  data: z.object({
    invoice: z
      .object({
        id: num,
        numero: s(100),
        identificativoSdI: num.nullish(),
        status: s(100),
        notifications: z.array(notification).max(200).nullish(),
      })
      .passthrough()
      .nullish(),
    inbox: z.record(z.string(), z.unknown()).nullish(),
  }),
});

const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.union([
      z.array(item).max(1000),
      z.object({
        data: z.array(item).max(1000),
        current_page: z.number().nullish(),
        last_page: z.number().nullish(),
      }),
    ]),
  });

/**
 * Maps `invoice.status`. Only `PRESA IN CARICO` and `INVIATA` are documented; the other values are the
 * Italian SDI outcome names and are TODO(verify). Unknown values map to `unknown`.
 */
export function mapKeliwebStatus(status: string | null | undefined): SdiStatus {
  switch ((status ?? '').trim().toUpperCase()) {
    case 'PRESA IN CARICO':
      return 'queued';
    case 'INVIATA':
      return 'sent';
    case 'CONSEGNATA':
      return 'delivered';
    case 'SCARTATA':
      return 'rejected';
    case 'NON CONSEGNATA':
    case 'MANCATA CONSEGNA':
    case 'IMPOSSIBILITA DI RECAPITO':
      return 'not-delivered';
    case 'ACCETTATA':
      return 'accepted';
    case 'RIFIUTATA':
      return 'refused';
    case 'DECORRENZA TERMINI':
      return 'deadline-expired';
    default:
      return 'unknown';
  }
}

export interface KeliwebProviderOptions {
  /** OAuth client and account credentials (password grant). Access tokens last 1 hour, refresh tokens 10 days. */
  credentials:
    | { clientId: string; clientSecret: string; username: string; password: string }
    | (() => Promise<{ clientId: string; clientSecret: string; username: string; password: string }>);
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

function multipart(fields: Record<string, string>): { body: Buffer; contentType: string } {
  const boundary = `----fatturapa${randomBytes(16).toString('hex')}`;
  const parts = Object.entries(fields).map(
    ([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  return {
    body: Buffer.from(`${parts.join('')}--${boundary}--\r\n`, 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Keliweb Fatturazione Elettronica API 2.0 (https://fatture.keliweb.it/docs/2.0/overview). Sends FatturaPA
 * XML (`POST /api/send-xml`). There is **no documented test environment**: every call acts on real data.
 * No webhooks are documented: poll `getStatus` and `listNotifications`.
 */
export class KeliwebProvider implements SdiProvider {
  readonly name = 'keliweb';
  readonly capabilities: ProviderCapabilities = {
    sendXml: true,
    sendModel: true,
    signature: false,
    receive: true,
    notifications: true,
    webhooks: false,
    sandbox: false,
  };
  readonly #http: HttpClient;
  readonly #tokens: TokenCache;

  constructor(options: KeliwebProviderOptions) {
    const dispatcher = options.dispatcher;
    const credentials = options.credentials;
    const token = async (form: Record<string, string>) => {
      const http = new HttpClient({
        provider: 'keliweb',
        baseUrl: KELIWEB_BASE_URL,
        authorization: () => undefined,
        maxRetries: 0,
        ...(dispatcher ? { dispatcher } : {}),
      });
      try {
        const response = await http.send({
          method: 'POST',
          path: '/oauth/token',
          body: new URLSearchParams(form).toString(),
          contentType: 'application/x-www-form-urlencoded',
          operation: 'oauthToken',
        });
        if (response.status !== 200) throw providerErrorFor('keliweb', 'oauthToken', response);
        const parsed = tokenResponse.safeParse(response.json());
        if (!parsed.success)
          throw new ProviderError('keliweb: unexpected token response', {
            provider: 'keliweb',
            operation: 'oauthToken',
            status: 200,
          });
        const now = Date.now();
        return {
          value: parsed.data.access_token,
          expiresAt: new Date(now + parsed.data.expires_in * 1000),
          ...(parsed.data.refresh_token
            ? { refreshToken: parsed.data.refresh_token, refreshExpiresAt: new Date(now + 10 * 86_400_000) }
            : {}),
        };
      } finally {
        await http.close();
      }
    };
    const resolve = async () => (typeof credentials === 'function' ? await credentials() : credentials);
    this.#tokens = new TokenCache({
      login: async () => {
        const c = await resolve();
        if (!c.clientId || !c.clientSecret || !c.username || !c.password)
          throw new FatturaPAError('keliweb: missing credentials');
        return token({
          grant_type: 'password',
          client_id: c.clientId,
          client_secret: c.clientSecret,
          username: c.username,
          password: c.password,
        });
      },
      refresh: async (refreshToken) => {
        const c = await resolve();
        return token({
          grant_type: 'refresh_token',
          client_id: c.clientId,
          client_secret: c.clientSecret,
          refresh_token: refreshToken,
        });
      },
    });
    const tokens = this.#tokens;
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl: KELIWEB_BASE_URL,
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
    if (!parsed.success)
      throw new ProviderError(`keliweb: unexpected ${operation} response (HTTP ${response.status})`, {
        provider: this.name,
        operation,
        status: response.status,
      });
    return parsed.data;
  }

  /** Sends an invoice. Never retried. A `status: "errors"` answer throws {@link ProviderValidationError}. */
  async send(input: SendInvoiceInput, options: CallOptions = {}): Promise<SendResult> {
    if ((input.xml === undefined) === (input.invoice === undefined))
      throw new RangeError('Pass exactly one of xml and invoice');
    const xml = input.xml ?? buildFatturaXml(input.invoice!);
    const form = multipart({ xml: typeof xml === 'string' ? xml : Buffer.from(xml).toString('utf8') });
    const response = await this.#http.send({
      method: 'POST',
      path: '/api/send-xml',
      body: form.body,
      contentType: form.contentType,
      operation: 'send',
      ...sig(options),
    });
    const r = this.#parse(sendResponse, response, 'send');
    if (r.status !== 'success') {
      const message = redact(r.message ?? '').slice(0, 1000);
      throw new ProviderValidationError(`keliweb: send refused: ${message}`, {
        provider: this.name,
        operation: 'send',
        status: response.status,
        messages: [message],
      });
    }
    const id = r.invoiceData?.invoiceId;
    if (id === undefined || id === null)
      throw new ProviderError('keliweb: send response has no invoiceId', {
        provider: this.name,
        operation: 'send',
        status: response.status,
      });
    return { provider: this.name, id: String(id), status: mapKeliwebStatus(r.invoiceData?.status) };
  }

  async getStatus(id: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    if (!/^\d{1,18}$/.test(id)) throw new RangeError('id must be a numeric Keliweb invoice id');
    const form = multipart({ invoiceId: id });
    const response = await this.#http.send({
      method: 'POST',
      path: '/api/get-invoice-info',
      body: form.body,
      contentType: form.contentType,
      operation: 'getStatus',
      ...sig(options),
    });
    const inv = this.#parse(invoiceInfo, response, 'getStatus').data.invoice;
    if (!inv)
      throw new ProviderError('keliweb: invoice not found in response', {
        provider: this.name,
        operation: 'getStatus',
        status: response.status,
      });
    const result: InvoiceStatusResult = {
      provider: this.name,
      id: String(inv.id),
      status: mapKeliwebStatus(inv.status),
    };
    if (inv.status) result.providerStatus = inv.status;
    if (inv.identificativoSdI) result.sdiIdentifier = String(inv.identificativoSdI);
    const ns = (inv.notifications ?? []).filter((n) => n.type === 'NS');
    if (ns.length > 0)
      result.errors = ns.map((n) => ({
        description: redact(n.descrizione ?? JSON.stringify(n.errors ?? 'NS')).slice(0, 1000),
      }));
    return result;
  }

  /** SDI notifications of your invoices. */
  async listNotifications(options: CallOptions = {}): Promise<KeliwebNotification[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/api/notifications',
      operation: 'listNotifications',
      ...sig(options),
    });
    const data = this.#parse(paginated(notification), response, 'listNotifications').data;
    return Array.isArray(data) ? data : data.data;
  }

  /** Received invoices (paginated, 25 per page); `isRead` filters read/unread. */
  async listReceived(
    query: { isRead?: boolean; page?: number } = {},
    options: CallOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const form = multipart(query.isRead === undefined ? {} : { is_read: query.isRead ? '1' : '0' });
    const response = await this.#http.send({
      method: 'POST',
      path: '/api/inboxes',
      ...(query.page ? { query: { page: query.page } } : {}),
      body: form.body,
      contentType: form.contentType,
      operation: 'listReceived',
      ...sig(options),
    });
    const data = this.#parse(paginated(z.record(z.string(), z.unknown())), response, 'listReceived').data;
    return Array.isArray(data) ? data : data.data;
  }

  async close(): Promise<void> {
    await this.#http.close();
  }
}

function sig(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
