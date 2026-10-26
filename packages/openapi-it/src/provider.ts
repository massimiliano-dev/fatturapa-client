import {
  assertHttpsBaseUrl,
  buildFatturaXml,
  FatturaPAError,
  HttpClient,
  pathSegment,
  ProviderError,
  providerErrorFor,
  redact,
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
import type { z } from 'zod';
import {
  apiConfiguration,
  businessRegistryConfiguration,
  createInvoiceResponse,
  envelope,
  getInvoiceResponse,
  listInvoicesResponse,
  listNotificationsResponse,
  type invoice,
  type notification,
} from './schemas.js';

/** Openapi.it environments (`servers` of the SDI OpenAPI document). */
export const OPENAPI_IT_HOSTS = {
  production: 'https://sdi.openapi.it',
  sandbox: 'https://test.sdi.openapi.it',
} as const;

export type OpenapiItEnvironment = keyof typeof OPENAPI_IT_HOSTS;

/** Options of {@link OpenapiItProvider}. */
export interface OpenapiItProviderOptions {
  environment: OpenapiItEnvironment;
  /**
   * Bearer token from oauth.openapi.it with the SDI scopes. Prefer a function that reads it from your
   * secret store, so that rotation needs no restart. Never hard-code it.
   */
  token: string | (() => string | Promise<string>);
  /** Override the base URL (HTTPS only), e.g. for a proxy. */
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

/** Extra services applied by Openapi.it when sending. */
export interface OpenapiItSendOptions extends CallOptions {
  /** Apply a qualified signature before sending (`/invoices_signature`). */
  signature?: boolean;
  /** Send the invoice to legal storage ("conservazione sostitutiva", `/invoices_legal_storage`). */
  legalStorage?: boolean;
}

export type OpenapiItInvoice = z.infer<typeof invoice>;
export type OpenapiItNotification = z.infer<typeof notification>;

/** Events that can be delivered to a callback URL (`POST /api_configurations`). */
export const OPENAPI_IT_CALLBACK_EVENTS = [
  'supplier-invoice',
  'customer-invoice',
  'customer-notification',
  'invoice-status-quarantena',
  'invoice-status-invoice-error',
  'legal-storage-missing-vat',
  'legal-storage-receipt',
] as const;
export type OpenapiItCallbackEvent = (typeof OPENAPI_IT_CALLBACK_EVENTS)[number];

/**
 * Maps the Openapi.it `marking` to the normalised status. Values documented in the `POST /invoices`
 * description: rejected, delivered, delivered-pa, not-delivered, accepted-pa, rejected-pa, deadline-terms.
 * TODO(verify): the intermediate values before the SDI outcome are not documented; `sent` and
 * `waiting` are assumed, anything else maps to `unknown` with the raw value in `providerStatus`.
 */
export function mapOpenapiItMarking(marking: string | null | undefined): SdiStatus {
  switch (marking) {
    case 'rejected':
      return 'rejected';
    case 'delivered':
    case 'delivered-pa':
      return 'delivered';
    case 'not-delivered':
      return 'not-delivered';
    case 'accepted-pa':
      return 'accepted';
    case 'rejected-pa':
      return 'refused';
    case 'deadline-terms':
      return 'deadline-expired';
    case 'invoice-error':
      return 'error';
    case 'quarantena':
    case 'waiting':
      return 'queued';
    case 'sent':
      return 'sent';
    default:
      return 'unknown';
  }
}

/**
 * Openapi.it SDI intermediary (https://console.openapi.com/apis/sdi/documentation). Sends FatturaPA XML
 * as is, so the document produced and validated by this library is exactly what reaches the SDI.
 *
 * Security notes:
 * - The bearer token grants invoicing on behalf of every configured company: keep it in a secret
 *   store, give it only the SDI scopes and a short TTL (`createOpenapiItToken`).
 * - Requests go only to the configured HTTPS origin; redirects are not followed.
 * - Invoice payloads and personal data are returned to you but never logged or put into errors.
 */
export class OpenapiItProvider implements SdiProvider {
  readonly name = 'openapi-it';
  readonly capabilities: ProviderCapabilities = {
    sendXml: true,
    sendModel: true,
    signature: true,
    receive: true,
    notifications: true,
    webhooks: true,
    sandbox: true,
  };
  readonly environment: OpenapiItEnvironment;
  readonly #http: HttpClient;

  constructor(options: OpenapiItProviderOptions) {
    if (!(options.environment in OPENAPI_IT_HOSTS))
      throw new RangeError('environment must be "production" or "sandbox"');
    this.environment = options.environment;
    const baseUrl = options.baseUrl ?? OPENAPI_IT_HOSTS[options.environment];
    assertHttpsBaseUrl(baseUrl);
    const token = options.token;
    if (typeof token === 'string' && token.trim() === '') throw new RangeError('token must not be empty');
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl,
      authorization: async () => {
        const value = typeof token === 'function' ? await token() : token;
        if (!value || /[\r\n]/.test(value)) throw new FatturaPAError('openapi-it: invalid token');
        return `Bearer ${value}`;
      },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
      ...(options.dispatcher === undefined ? {} : { dispatcher: options.dispatcher }),
      userAgent: 'fatturapa-client (+https://github.com/massimiliano-dev/fatturapa-client)',
    });
  }

  #parse<T extends z.ZodTypeAny>(schema: T, response: HttpResponse, operation: string): z.infer<T> {
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, operation, response);
    const parsed = schema.safeParse(response.json());
    if (!parsed.success) {
      throw new ProviderError(`openapi-it: unexpected ${operation} response (HTTP ${response.status})`, {
        provider: this.name,
        operation,
        status: response.status,
      });
    }
    const body = parsed.data as { success?: boolean | null; message?: string | null };
    if (body.success === false) {
      throw new ProviderError(
        `openapi-it: ${operation} failed${body.message ? `: ${redact(body.message).slice(0, 500)}` : ''}`,
        {
          provider: this.name,
          operation,
          status: response.status,
        },
      );
    }
    return parsed.data;
  }

  /**
   * Sends an invoice to the SDI. With `invoice`, the model is serialised with `buildFatturaXml` (run
   * `computeTotals` and your validations first). Never retried: on a timeout, look the invoice up with
   * {@link listInvoices} before sending again, or you risk a duplicate (SDI code 00404).
   */
  async send(input: SendInvoiceInput, options: OpenapiItSendOptions = {}): Promise<SendResult> {
    if ((input.xml === undefined) === (input.invoice === undefined))
      throw new RangeError('Pass exactly one of xml and invoice');
    const xml = input.xml ?? buildFatturaXml(input.invoice!);
    const path =
      options.signature && options.legalStorage
        ? '/invoices_signature_legal_storage'
        : options.signature
          ? '/invoices_signature'
          : options.legalStorage
            ? '/invoices_legal_storage'
            : '/invoices';
    const response = await this.#http.send({
      method: 'POST',
      path,
      body: xml,
      contentType: 'application/xml',
      operation: 'send',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const parsed = this.#parse(createInvoiceResponse, response, 'send');
    if (!parsed.data?.uuid)
      throw new ProviderError('openapi-it: send response has no uuid', {
        provider: this.name,
        operation: 'send',
        status: response.status,
      });
    return { provider: this.name, id: parsed.data.uuid, status: 'queued' };
  }

  /** Reads an invoice (sent or received). `payload` holds the XML: treat it as personal data. */
  async getInvoice(uuid: string, options: CallOptions = {}): Promise<OpenapiItInvoice> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/invoices/${pathSegment(uuid)}`,
      operation: 'getInvoice',
      ...signal(options),
    });
    const parsed = this.#parse(getInvoiceResponse, response, 'getInvoice');
    if (!parsed.data)
      throw new ProviderError('openapi-it: invoice not found in response', {
        provider: this.name,
        operation: 'getInvoice',
        status: response.status,
      });
    return parsed.data;
  }

  async getStatus(uuid: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    const inv = await this.getInvoice(uuid, options);
    const result: InvoiceStatusResult = {
      provider: this.name,
      id: inv.uuid,
      status: mapOpenapiItMarking(inv.marking),
    };
    if (inv.marking) result.providerStatus = inv.marking;
    if (inv.sdi_file_id !== undefined && inv.sdi_file_id !== null)
      result.sdiIdentifier = String(inv.sdi_file_id);
    if (inv.sdi_file_name) result.sdiFileName = inv.sdi_file_name;
    if (inv.notice) result.errors = [{ description: redact(inv.notice).slice(0, 1000) }];
    return result;
  }

  /**
   * Lists invoices. `type: 0` = sent (customer invoices), `type: 1` = received (supplier invoices).
   * Other filters follow the API's query names, e.g. `{ 'createdAt[after]': '2026-01-01', marking: 'rejected' }`.
   */
  async listInvoices(
    query: { type?: 0 | 1; page?: number } & Record<string, string | number | boolean | undefined> = {},
    options: CallOptions = {},
  ): Promise<OpenapiItInvoice[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/invoices',
      query,
      operation: 'listInvoices',
      ...signal(options),
    });
    return this.#parse(listInvoicesResponse, response, 'listInvoices').data ?? [];
  }

  /** SDI notifications (NS, RC, MC, NE, DT, AT, MT…) of an invoice, as JSON. */
  async listNotifications(uuid: string, options: CallOptions = {}): Promise<OpenapiItNotification[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/invoices_notifications/${pathSegment(uuid)}`,
      operation: 'listNotifications',
      ...signal(options),
    });
    return this.#parse(listNotificationsResponse, response, 'listNotifications').data ?? [];
  }

  /**
   * Downloads an invoice: `xml`, `raw` (the original file, XML or P7M; open P7M with `extractP7mContent`),
   * `pdf` or `html` (rendered with a stylesheet).
   */
  async downloadInvoice(
    uuid: string,
    format: 'xml' | 'raw' | 'pdf' | 'html' = 'xml',
    options: CallOptions = {},
  ): Promise<Uint8Array> {
    const accept = {
      xml: 'application/xml',
      raw: 'application/octet-stream',
      pdf: 'application/pdf',
      html: 'text/html',
    }[format];
    const response = await this.#http.send({
      method: 'GET',
      path: `/invoices_download/${pathSegment(uuid)}`,
      accept,
      operation: 'downloadInvoice',
      ...signal(options),
    });
    if (response.status !== 200) throw providerErrorFor(this.name, 'downloadInvoice', response);
    return new Uint8Array(response.body);
  }

  /**
   * Registers a company (fiscal_id = VAT number or fiscal code, without country prefix) with the services
   * to apply. One-off setup.
   */
  async createBusinessRegistryConfiguration(
    input: {
      fiscal_id: string;
      name: string;
      email: string;
      apply_signature: boolean;
      apply_legal_storage: boolean;
    },
    options: CallOptions = {},
  ): Promise<z.infer<typeof businessRegistryConfiguration>> {
    const response = await this.#http.send({
      method: 'POST',
      path: '/business_registry_configurations',
      json: input,
      operation: 'createBusinessRegistryConfiguration',
      ...signal(options),
    });
    return (
      this.#parse(envelope(businessRegistryConfiguration), response, 'createBusinessRegistryConfiguration')
        .data ?? {}
    );
  }

  async listBusinessRegistryConfigurations(
    options: CallOptions = {},
  ): Promise<z.infer<typeof businessRegistryConfiguration>[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/business_registry_configurations',
      operation: 'listBusinessRegistryConfigurations',
      ...signal(options),
    });
    const schema = envelope(businessRegistryConfiguration.array().max(1000));
    return this.#parse(schema, response, 'listBusinessRegistryConfigurations').data ?? [];
  }

  /**
   * Configures the callback endpoints of a company. **It replaces the previous configuration**: pass all
   * the endpoints you need. URLs must be HTTPS. `authorization` is the value Openapi.it sends back in the
   * auth header of each callback: use a long random secret (see {@link verifyOpenapiItCallback}).
   * TODO(verify): the OpenAPI describes `auth_header` as the header *name* but its examples carry a value
   * (`"Bearer 123456789"`); this adapter sends your value as documented by the examples.
   */
  async configureCallbacks(
    fiscalId: string,
    callbacks: readonly {
      event: OpenapiItCallbackEvent;
      url: string;
      authorization: string;
      field?: string;
    }[],
    options: CallOptions = {},
  ): Promise<z.infer<typeof apiConfiguration>> {
    for (const cb of callbacks) {
      if (!OPENAPI_IT_CALLBACK_EVENTS.includes(cb.event))
        throw new RangeError(`Unknown callback event ${cb.event}`);
      assertHttpsBaseUrl(new URL(cb.url).origin, 'callback url');
      if (cb.authorization.length < 32)
        throw new RangeError('callback authorization must be a secret of at least 32 characters');
    }
    const response = await this.#http.send({
      method: 'POST',
      path: '/api_configurations',
      json: {
        fiscal_id: fiscalId,
        callbacks: callbacks.map((cb) => ({
          event: cb.event,
          url: cb.url,
          auth_header: cb.authorization,
          ...(cb.field ? { field: cb.field } : {}),
        })),
      },
      operation: 'configureCallbacks',
      ...signal(options),
    });
    return this.#parse(envelope(apiConfiguration), response, 'configureCallbacks').data ?? {};
  }

  /**
   * Sandbox only: simulates an SDI event (`supplier-invoice`, `customer-notification`,
   * `legal-storage-receipt`), delivered to your callbacks. Refused in production.
   */
  async simulate(
    type: 'supplier-invoice' | 'customer-notification' | 'legal-storage-receipt',
    body: unknown,
    options: CallOptions = {},
  ): Promise<unknown> {
    if (this.environment !== 'sandbox')
      throw new FatturaPAError('openapi-it: simulate is available only in the sandbox');
    const response = await this.#http.send({
      method: 'POST',
      path: `/simulate/${pathSegment(type)}`,
      json: body,
      operation: 'simulate',
      ...signal(options),
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'simulate', response);
    return response.json();
  }

  async close(): Promise<void> {
    await this.#http.close();
  }
}

function signal(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
