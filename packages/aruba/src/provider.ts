import {
  buildFatturaXml,
  cloneModel,
  FatturaPAError,
  HttpClient,
  ProviderError,
  providerErrorFor,
  ProviderValidationError,
  redact,
  TokenCache,
  type CallOptions,
  type FatturaElettronica,
  type HttpResponse,
  type InvoiceStatusResult,
  type ProviderCapabilities,
  type SdiProvider,
  type SdiStatus,
  type SendInvoiceInput,
  type SendResult,
} from '@massimiliano-dev/fatturapa-core';
import type { Dispatcher } from 'undici';
import type { z } from 'zod';
import {
  invoiceItem,
  notificationsResponse,
  page,
  signinResponse,
  uploadResponse,
  type ArubaInvoice,
  type ArubaNotification,
} from './schemas.js';

/** Base URLs (docs §2). */
export const ARUBA_HOSTS = {
  demo: {
    auth: 'https://demoauth.fatturazioneelettronica.aruba.it',
    ws: 'https://demows.fatturazioneelettronica.aruba.it',
  },
  production: {
    auth: 'https://auth.fatturazioneelettronica.aruba.it',
    ws: 'https://ws.fatturazioneelettronica.aruba.it',
  },
} as const;
export type ArubaEnvironment = keyof typeof ARUBA_HOSTS;

/**
 * Aruba PEC S.p.A. as transmitter. Aruba rejects files whose transmitter differs from its own data
 * (synchronous check 0094). The VAT number is the one in Aruba's documented file names
 * (IT01879020517_…). TODO(verify) the exact transmitter data Aruba expects.
 */
export const ARUBA_TRANSMITTER = { IdPaese: 'IT', IdCodice: '01879020517' } as const;

/** Returns a copy of the invoice with Aruba as transmitter and no transmitter contacts. */
export function withArubaTransmitter(invoice: FatturaElettronica): FatturaElettronica {
  const copy = cloneModel(invoice);
  const t = copy.FatturaElettronicaHeader.DatiTrasmissione;
  t.IdTrasmittente = { ...ARUBA_TRANSMITTER };
  delete t.ContattiTrasmittente;
  return copy;
}

export interface ArubaProviderOptions {
  environment: ArubaEnvironment;
  /** Panel credentials. Logins are limited to one per minute per IP: tokens are cached and refreshed. */
  credentials:
    { username: string; password: string } | (() => Promise<{ username: string; password: string }>);
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

export interface ArubaSendOptions extends CallOptions {
  /** Validate only, do not send to the SDI. */
  dryRun?: boolean;
  /** Automatic signature credentials ("credential" and "domain"), if your account has them. */
  autoSignature?: { credential: string; domain: string };
  /** Skip Aruba's extra-schema checks (the SDI runs them anyway). Default false. */
  skipExtraSchema?: boolean;
  /** For TD26 only: sender VAT with country code (e.g. IT01234567890). */
  senderPIVA?: string;
  /** Upload an already signed file (CAdES .p7m or XAdES) with `/uploadSigned`. */
  signed?: boolean;
}

/** Synchronous check codes (docs §7.6.1) that mean "invalid content" rather than a transient failure. */
const VALIDATION_CODES = new Set(['0002', '0033', '0034', '0092', '0093', '0094', '0096', '0097', '0098']);

/** Maps the Italian invoice status names of docs §8.1. */
export function mapArubaStatus(status: string | null | undefined): SdiStatus {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'presa in carico':
      return 'queued';
    case 'errore elaborazione':
    case 'errore creazione':
    case 'errore sdi':
      return 'error';
    case 'inviata':
      return 'sent';
    case 'scartata':
      return 'rejected';
    case 'non consegnata':
    case 'recapito impossibile':
      return 'not-delivered';
    case 'consegnata':
      return 'delivered';
    case 'accettata':
      return 'accepted';
    case 'rifiutata':
      return 'refused';
    case 'decorrenza termini':
      return 'deadline-expired';
    default:
      return 'unknown';
  }
}

/**
 * Aruba Fatturazione Elettronica (https://fatturazioneelettronica.aruba.it/apidoc/v2/docs_EN.html).
 * Uploads FatturaPA XML (base64 in JSON); Aruba signs it if requested and transmits it. The provider id
 * of an invoice is the file name Aruba assigns (`IT01879020517_xxxxx.xml.p7m`).
 *
 * Rate limits are strict (12 searches and 30 uploads per minute per IP; tiers apply): GET retries honour
 * Retry-After, uploads are never retried.
 */
export class ArubaProvider implements SdiProvider {
  readonly name = 'aruba';
  readonly capabilities: ProviderCapabilities = {
    sendXml: true,
    sendModel: true,
    signature: true,
    receive: true,
    notifications: true,
    webhooks: true,
    sandbox: true,
  };
  readonly environment: ArubaEnvironment;
  readonly #http: HttpClient;
  readonly #tokens: TokenCache;

  constructor(options: ArubaProviderOptions) {
    if (!(options.environment in ARUBA_HOSTS))
      throw new RangeError('environment must be "demo" or "production"');
    this.environment = options.environment;
    const hosts = ARUBA_HOSTS[options.environment];
    const dispatcher = options.dispatcher;
    const credentials = options.credentials;
    const signin = async (form: Record<string, string>) => {
      const http = new HttpClient({
        provider: 'aruba',
        baseUrl: hosts.auth,
        authorization: () => undefined,
        maxRetries: 0,
        ...(dispatcher ? { dispatcher } : {}),
      });
      try {
        // Credentials in the body, never in the query string (docs §5: Aruba blocks the latter).
        const response = await http.send({
          method: 'POST',
          path: '/auth/signin',
          body: new URLSearchParams(form).toString(),
          contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
          operation: 'signin',
        });
        if (response.status !== 200) throw providerErrorFor('aruba', 'signin', response);
        const parsed = signinResponse.safeParse(response.json());
        if (!parsed.success)
          throw new ProviderError('aruba: unexpected signin response', {
            provider: 'aruba',
            operation: 'signin',
            status: 200,
          });
        const now = Date.now();
        return {
          value: parsed.data.access_token,
          expiresAt: new Date(now + parsed.data.expires_in * 1000),
          ...(parsed.data.refresh_token
            ? { refreshToken: parsed.data.refresh_token, refreshExpiresAt: new Date(now + 60 * 60_000) }
            : {}),
        };
      } finally {
        await http.close();
      }
    };
    this.#tokens = new TokenCache({
      login: async () => {
        const { username, password } = typeof credentials === 'function' ? await credentials() : credentials;
        if (!username || !password) throw new FatturaPAError('aruba: missing credentials');
        return signin({ grant_type: 'password', username, password });
      },
      refresh: (refreshToken) => signin({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      marginSeconds: 120,
    });
    const tokens = this.#tokens;
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl: hosts.ws,
      authorization: async () => `Bearer ${await tokens.get()}`,
      onUnauthorized: (rejected) => tokens.invalidate(rejected?.replace(/^Bearer /, '')),
      maxRetryWaitSeconds: 90,
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
      throw new ProviderError(`aruba: unexpected ${operation} response (HTTP ${response.status})`, {
        provider: this.name,
        operation,
        status: response.status,
      });
    return parsed.data;
  }

  /**
   * Uploads an invoice. With `invoice`, Aruba is set as transmitter ({@link withArubaTransmitter}); with
   * `xml` the document is sent as is. A non-zero synchronous code throws {@link ProviderValidationError}
   * (or {@link ProviderError} for transient ones) with Aruba's code in `details.messages[0]`.
   */
  async send(input: SendInvoiceInput, options: ArubaSendOptions = {}): Promise<SendResult> {
    if ((input.xml === undefined) === (input.invoice === undefined))
      throw new RangeError('Pass exactly one of xml and invoice');
    if (options.signed && input.invoice) throw new RangeError('signed uploads take the signed file as `xml`');
    const data = input.xml ?? buildFatturaXml(withArubaTransmitter(input.invoice!));
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    if (bytes.byteLength > 5 * 1024 * 1024) throw new RangeError('Aruba accepts files up to 5 MB');
    if (options.senderPIVA !== undefined && !/^[A-Z]{2}[A-Za-z0-9]{2,28}$/.test(options.senderPIVA))
      throw new RangeError('senderPIVA must include the country code');
    const response = await this.#http.send({
      method: 'POST',
      path: options.signed ? '/services/invoice/uploadSigned' : '/services/invoice/upload',
      json: {
        dataFile: bytes.toString('base64'),
        ...(options.autoSignature && !options.signed
          ? { credential: options.autoSignature.credential, domain: options.autoSignature.domain }
          : {}),
        ...(options.senderPIVA ? { senderPIVA: options.senderPIVA } : {}),
        skipExtraSchema: options.skipExtraSchema ?? false,
        dryRun: options.dryRun ?? false,
      },
      operation: 'upload',
      ...sig(options),
    });
    const r = this.#parse(uploadResponse, response, 'upload');
    const code = r.errorCode ?? '';
    if (code !== '' && code !== '0000') {
      const description = redact(r.errorDescription ?? '').slice(0, 1000);
      const details = {
        provider: this.name,
        operation: 'upload',
        status: response.status,
        messages: [code, description],
      };
      throw VALIDATION_CODES.has(code)
        ? new ProviderValidationError(`aruba: upload refused (${code}): ${description}`, details)
        : new ProviderError(`aruba: upload failed (${code}): ${description}`, details);
    }
    if (options.dryRun) return { provider: this.name, id: r.uploadFileName ?? '', status: 'draft' };
    if (!r.uploadFileName)
      throw new ProviderError('aruba: upload response has no file name', {
        provider: this.name,
        operation: 'upload',
        status: response.status,
      });
    return { provider: this.name, id: r.uploadFileName, status: 'queued' };
  }

  /** Sent invoice by `filename`, `id` or `idSdi`. The base64 file is omitted unless `includeFile`. */
  async getSentInvoice(
    lookup: { filename: string } | { id: string } | { idSdi: string },
    options: CallOptions & { includeFile?: boolean; includePdf?: boolean } = {},
  ): Promise<ArubaInvoice> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/api/v2/invoices-out/detail',
      query: {
        ...lookup,
        includeFile: options.includeFile ?? false,
        ...(options.includePdf ? { includePdf: true } : {}),
      },
      operation: 'getSentInvoice',
      ...sig(options),
    });
    return this.#parse(invoiceItem, response, 'getSentInvoice');
  }

  async getStatus(filename: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    const inv = await this.getSentInvoice({ filename }, options);
    const doc = inv.invoices?.[0];
    const status = mapArubaStatus(doc?.status);
    const result: InvoiceStatusResult = { provider: this.name, id: inv.filename ?? filename, status };
    if (doc?.status) result.providerStatus = doc.status;
    if (inv.idSdi !== null && inv.idSdi !== undefined && String(inv.idSdi) !== '')
      result.sdiIdentifier = String(inv.idSdi);
    if (inv.filename) result.sdiFileName = inv.filename;
    const errors = [
      ...(inv.sdiErrors ?? []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e))),
      ...(doc?.statusDescription ? [doc.statusDescription] : []),
    ];
    if (errors.length > 0 && (status === 'rejected' || status === 'error')) {
      result.errors = errors.slice(0, 50).map((e) => ({ description: redact(e).slice(0, 1000) }));
    }
    return result;
  }

  /**
   * SDI notifications of a sent invoice, with the XML decoded (parse it with `parseSdiNotification`).
   */
  async listSentNotifications(
    filename: string,
    options: CallOptions = {},
  ): Promise<(ArubaNotification & { xml?: Uint8Array })[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/api/v2/invoices-out/notifications',
      query: { filename },
      operation: 'listSentNotifications',
      ...sig(options),
    });
    return this.#parse(notificationsResponse, response, 'listSentNotifications').notifications.map((n) => ({
      ...n,
      ...(n.file ? { xml: new Uint8Array(Buffer.from(n.file, 'base64')) } : {}),
    }));
  }

  /**
   * Searches sent (`out`) or received (`in`) invoices. Aruba requires a creation window of at most two
   * days; Premium users must also pass the sender (out) or receiver (in) VAT.
   */
  async searchInvoices(
    direction: 'out' | 'in',
    query: { creationStartDate: string; creationEndDate: string; page?: number; size?: number } & Record<
      string,
      string | number | undefined
    >,
    options: CallOptions = {},
  ): Promise<z.infer<typeof page>> {
    const start = Date.parse(query.creationStartDate);
    const end = Date.parse(query.creationEndDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 2 * 86_400_000) {
      throw new RangeError('creationStartDate/creationEndDate must be ISO 8601 dates at most two days apart');
    }
    const response = await this.#http.send({
      method: 'GET',
      path: `/api/v2/invoices-${direction}`,
      query,
      operation: 'searchInvoices',
      ...sig(options),
    });
    return this.#parse(page, response, 'searchInvoices');
  }

  /** A received invoice with its file (base64; usually a `.p7m`: open it with `extractP7mContent`). */
  async getReceivedInvoice(
    lookup: { filename: string } | { id: string } | { idSdi: string },
    options: CallOptions = {},
  ): Promise<ArubaInvoice> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/api/v2/invoices-in/detail',
      query: { ...lookup, includeFile: true },
      operation: 'getReceivedInvoice',
      ...sig(options),
    });
    return this.#parse(invoiceItem, response, 'getReceivedInvoice');
  }

  /** Demo only: simulates an SDI notification (NS, MC, AT, RC, NE_EC01, NE_EC02, DT) for a sent invoice. */
  async simulateNotification(
    invoiceFileName: string,
    notificationType: 'NS' | 'MC' | 'AT' | 'RC' | 'NE_EC01' | 'NE_EC02' | 'DT',
    options: CallOptions = {},
  ): Promise<unknown> {
    if (this.environment !== 'demo')
      throw new FatturaPAError('aruba: the SDI simulator exists only in the demo environment');
    const response = await this.#http.send({
      method: 'POST',
      path: '/services/sdisimulator/notificationOut',
      json: { invoiceFileName, notificationType },
      operation: 'simulateNotification',
      ...sig(options),
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'simulateNotification', response);
    return response.json();
  }

  /** Demo only: simulates receiving an invoice for the given customer. */
  async simulateReceivedInvoice(
    receiver: { countryReceiver: string; vatcodeReceiver: string; fiscalcodeReceiver?: string },
    options: CallOptions = {},
  ): Promise<unknown> {
    if (this.environment !== 'demo')
      throw new FatturaPAError('aruba: the SDI simulator exists only in the demo environment');
    const response = await this.#http.send({
      method: 'POST',
      path: '/services/sdisimulator/invoiceIn',
      json: { fiscalcodeReceiver: null, ...receiver },
      operation: 'simulateReceivedInvoice',
      ...sig(options),
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'simulateReceivedInvoice', response);
    return response.json();
  }

  async close(): Promise<void> {
    await this.#http.close();
  }
}

function sig(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
