import {
  assertHttpsBaseUrl,
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
import type { z } from 'zod';
import {
  apiConfiguration,
  businessRegistryConfiguration,
  collection,
  created,
  invoice,
  loginResponse,
  notification,
  type AcubeApiConfiguration,
  type AcubeInvoice,
  type AcubeNotification,
} from './schemas.js';

/** API hosts (`servers` of gov-it-api.json) and the common login host (docs: Authentication). */
export const ACUBE_HOSTS = {
  production: 'https://api.acubeapi.com',
  sandbox: 'https://api-sandbox.acubeapi.com',
} as const;
export const ACUBE_LOGIN_URL = 'https://common.api.acubeapi.com';

export type AcubeEnvironment = keyof typeof ACUBE_HOSTS;

/** Webhook events relevant to invoices (docs: Italy › Webhooks). */
export const ACUBE_EVENTS = [
  'supplier-invoice',
  'customer-invoice',
  'customer-notification',
  'invoice-status-quarantena',
  'invoice-status-invoice-error',
  'legal-storage-missing-vat',
  'legal-storage-receipt',
  'job',
  'job-error',
] as const;
export type AcubeEvent = (typeof ACUBE_EVENTS)[number];

export interface AcubeProviderOptions {
  environment: AcubeEnvironment;
  /**
   * Account credentials, exchanged for a 24-hour JWT (`POST /login`) that is cached and renewed. Pass a
   * function to read them from a secret store. Alternatively pass `token` if you manage the JWT yourself.
   */
  credentials?: { email: string; password: string } | (() => Promise<{ email: string; password: string }>);
  token?: () => string | Promise<string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

/**
 * Maps the `marking` (docs: "Connect your ERP › Outcomes": waiting, quarantena, sent, rejected, delivered,
 * delivered-pa, not-delivered, invoice-error). The PA outcome values are assumed to match Openapi.it, which
 * exposes the same invoice model: TODO(verify) accepted-pa, rejected-pa, deadline-terms.
 */
export function mapAcubeMarking(marking: string | null | undefined): SdiStatus {
  switch (marking) {
    case 'waiting':
    case 'quarantena':
      return 'queued';
    case 'sent':
      return 'sent';
    case 'rejected':
      return 'rejected';
    case 'delivered':
    case 'delivered-pa':
      return 'delivered';
    case 'not-delivered':
      return 'not-delivered';
    case 'invoice-error':
      return 'error';
    case 'accepted-pa':
      return 'accepted';
    case 'rejected-pa':
      return 'refused';
    case 'deadline-terms':
      return 'deadline-expired';
    default:
      return 'unknown';
  }
}

/** Reads `exp` from a JWT without verifying it (only to know when to renew our own token). */
function jwtExpiry(token: string): Date | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? new Date(exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A-Cube API (https://docs.acubeapi.com/documentation/italy). Sends FatturaPA XML as is
 * (`POST /invoices`, `Content-Type: application/xml`); the sandbox never reaches the SDI.
 */
export class AcubeProvider implements SdiProvider {
  readonly name = 'acube';
  readonly capabilities: ProviderCapabilities = {
    sendXml: true,
    sendModel: true,
    signature: true,
    receive: true,
    notifications: true,
    webhooks: true,
    sandbox: true,
  };
  readonly environment: AcubeEnvironment;
  readonly #http: HttpClient;
  readonly #tokens: TokenCache | undefined;

  constructor(options: AcubeProviderOptions) {
    if (!(options.environment in ACUBE_HOSTS))
      throw new RangeError('environment must be "production" or "sandbox"');
    if ((options.credentials === undefined) === (options.token === undefined))
      throw new RangeError('Pass exactly one of credentials and token');
    this.environment = options.environment;
    const dispatcher = options.dispatcher;
    if (options.credentials) {
      const credentials = options.credentials;
      this.#tokens = new TokenCache({
        login: async () => {
          const { email, password } = typeof credentials === 'function' ? await credentials() : credentials;
          const token = await acubeLogin({
            email,
            password,
            environment: options.environment,
            ...(dispatcher ? { dispatcher } : {}),
          });
          return { value: token, expiresAt: jwtExpiry(token) ?? new Date(Date.now() + 23 * 3600 * 1000) };
        },
        marginSeconds: 300,
      });
    }
    const tokens = this.#tokens;
    const external = options.token;
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl: ACUBE_HOSTS[options.environment],
      authorization: async () => `Bearer ${tokens ? await tokens.get() : await external!()}`,
      ...(tokens
        ? { onUnauthorized: (rejected) => tokens.invalidate(rejected?.replace(/^Bearer /, '')) }
        : {}),
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
      throw new ProviderError(`acube: unexpected ${operation} response (HTTP ${response.status})`, {
        provider: this.name,
        operation,
        status: response.status,
      });
    }
    return parsed.data;
  }

  /** Sends an invoice; it is queued (202) and its outcome arrives via `customer-notification`. Never retried. */
  async send(
    input: SendInvoiceInput,
    options: CallOptions & { disableWebhooks?: boolean } = {},
  ): Promise<SendResult> {
    if ((input.xml === undefined) === (input.invoice === undefined))
      throw new RangeError('Pass exactly one of xml and invoice');
    const xml = input.xml ?? buildFatturaXml(input.invoice!);
    const response = await this.#http.send({
      method: 'POST',
      path: '/invoices',
      body: xml,
      contentType: 'application/xml',
      ...(options.disableWebhooks ? { headers: { 'x-disableendpoints': 'true' } } : {}),
      operation: 'send',
      ...sig(options),
    });
    return { provider: this.name, id: this.#parse(created, response, 'send').uuid, status: 'queued' };
  }

  /** Validates an invoice on A-Cube without sending it. Returns the provider's messages (empty if valid). */
  async validate(xml: string | Uint8Array, options: CallOptions = {}): Promise<string[]> {
    const response = await this.#http.send({
      method: 'POST',
      path: '/invoices/validate',
      body: xml,
      contentType: 'application/xml',
      operation: 'validate',
      ...sig(options),
    });
    if (response.status >= 200 && response.status < 300) return [];
    if (response.status === 400 || response.status === 422)
      return providerErrorFor(this.name, 'validate', response).details.messages ?? ['invalid'];
    throw providerErrorFor(this.name, 'validate', response);
  }

  async getInvoice(uuid: string, options: CallOptions = {}): Promise<AcubeInvoice> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/invoices/${pathSegment(uuid)}`,
      operation: 'getInvoice',
      ...sig(options),
    });
    return this.#parse(invoice, response, 'getInvoice');
  }

  async getStatus(uuid: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    const inv = await this.getInvoice(uuid, options);
    const result: InvoiceStatusResult = {
      provider: this.name,
      id: inv.uuid,
      status: mapAcubeMarking(inv.marking),
    };
    if (inv.marking) result.providerStatus = inv.marking;
    if (inv.sdi_file_id !== null && inv.sdi_file_id !== undefined)
      result.sdiIdentifier = String(inv.sdi_file_id);
    if (inv.sdi_file_name) result.sdiFileName = inv.sdi_file_name;
    if (inv.notice) result.errors = [{ description: redact(inv.notice).slice(0, 1000) }];
    return result;
  }

  /** Lists invoices; `type: 0` sent, `type: 1` received. Other filters use the API's query names. */
  async listInvoices(
    query: Record<string, string | number | boolean | undefined> = {},
    options: CallOptions = {},
  ): Promise<AcubeInvoice[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/invoices',
      query,
      operation: 'listInvoices',
      ...sig(options),
    });
    return this.#parse(collection(invoice), response, 'listInvoices');
  }

  async listNotifications(uuid: string, options: CallOptions = {}): Promise<AcubeNotification[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/invoices/${pathSegment(uuid)}/notifications`,
      operation: 'listNotifications',
      ...sig(options),
    });
    return this.#parse(collection(notification), response, 'listNotifications');
  }

  /** Downloads an invoice as `xml`, `raw` (original XML or P7M), `pdf` or `html`. */
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
      path: `/invoices/${pathSegment(uuid)}`,
      accept,
      operation: 'downloadInvoice',
      ...sig(options),
    });
    if (response.status !== 200) throw providerErrorFor(this.name, 'downloadInvoice', response);
    return new Uint8Array(response.body);
  }

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
      path: '/business-registry-configurations',
      json: input,
      operation: 'createBusinessRegistryConfiguration',
      ...sig(options),
    });
    return this.#parse(businessRegistryConfiguration, response, 'createBusinessRegistryConfiguration');
  }

  /**
   * Registers a webhook endpoint for one event. A-Cube signs every call (verify with
   * `verifyAcubeWebhook`); the optional static token adds a second factor
   * (`Authorization: <authenticationKey> <token>`, at least 32 characters).
   */
  async createWebhook(
    input: { event: AcubeEvent; url: string; authenticationKey?: string; authenticationToken?: string },
    options: CallOptions = {},
  ): Promise<AcubeApiConfiguration> {
    if (!ACUBE_EVENTS.includes(input.event)) throw new RangeError(`unknown event ${input.event}`);
    assertHttpsBaseUrl(new URL(input.url).origin, 'webhook url');
    if (input.authenticationToken !== undefined && input.authenticationToken.length < 32) {
      throw new RangeError('authenticationToken must be at least 32 characters');
    }
    const response = await this.#http.send({
      method: 'POST',
      path: '/api-configurations',
      json: {
        event: input.event,
        target_url: input.url,
        ...(input.authenticationToken
          ? {
              authentication_type: 'header',
              authentication_key: input.authenticationKey ?? 'Bearer',
              authentication_token: input.authenticationToken,
            }
          : {}),
      },
      operation: 'createWebhook',
      ...sig(options),
    });
    return this.#parse(apiConfiguration, response, 'createWebhook');
  }

  async listWebhooks(options: CallOptions = {}): Promise<AcubeApiConfiguration[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/api-configurations',
      operation: 'listWebhooks',
      ...sig(options),
    });
    return this.#parse(collection(apiConfiguration), response, 'listWebhooks');
  }

  async deleteWebhook(uuid: string, options: CallOptions = {}): Promise<void> {
    const response = await this.#http.send({
      method: 'DELETE',
      path: `/api-configurations/${pathSegment(uuid)}`,
      operation: 'deleteWebhook',
      ...sig(options),
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'deleteWebhook', response);
  }

  async close(): Promise<void> {
    await this.#http.close();
  }
}

/** `POST https://common.api.acubeapi.com/login`: exchanges account credentials for a 24-hour JWT. */
export async function acubeLogin(input: {
  email: string;
  password: string;
  environment: AcubeEnvironment;
  dispatcher?: Dispatcher;
}): Promise<string> {
  if (!input.email || !input.password) throw new FatturaPAError('acube: missing credentials');
  const http = new HttpClient({
    provider: 'acube',
    baseUrl: ACUBE_LOGIN_URL,
    authorization: () => undefined,
    maxRetries: 0,
    ...(input.dispatcher ? { dispatcher: input.dispatcher } : {}),
  });
  try {
    const response = await http.send({
      method: 'POST',
      path: '/login',
      json: { email: input.email, password: input.password, environment: input.environment },
      operation: 'login',
    });
    if (response.status !== 200) throw providerErrorFor('acube', 'login', response);
    const parsed = loginResponse.safeParse(response.json());
    if (!parsed.success)
      throw new ProviderError('acube: unexpected login response', {
        provider: 'acube',
        operation: 'login',
        status: 200,
      });
    return parsed.data.token;
  } finally {
    await http.close();
  }
}

function sig(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
