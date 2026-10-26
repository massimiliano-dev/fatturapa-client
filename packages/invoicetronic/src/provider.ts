import {
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
import { z } from 'zod';
import {
  company,
  receive,
  send,
  status,
  update,
  webhook,
  type InvoicetronicCompany,
  type InvoicetronicReceive,
  type InvoicetronicSend,
  type InvoicetronicUpdate,
  type InvoicetronicWebhook,
} from './schemas.js';

export const INVOICETRONIC_BASE_URL = 'https://api.invoicetronic.com/v1';

/** Webhook events (invoicetronic.com/en/docs/webhooks). */
export const INVOICETRONIC_EVENTS = [
  'send.add',
  'send.delete',
  'receive.add',
  'receive.delete',
  'update.add',
  'update.delete',
  'company.add',
  'company.delete',
  '*',
] as const;
export type InvoicetronicEvent = (typeof INVOICETRONIC_EVENTS)[number];

export interface InvoicetronicProviderOptions {
  /**
   * API key. The prefix selects the environment: `ik_test_` = sandbox (no SDI traffic, free),
   * `ik_live_` = live. Pass a function to read it from a secret store.
   */
  apiKey: string | (() => string | Promise<string>);
  /** Refuse keys of the other environment. Default `sandbox`. */
  environment?: 'sandbox' | 'live';
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

export interface InvoicetronicSendOptions extends CallOptions {
  /** Validate on Invoicetronic before queuing, and reject on failure. Default true. */
  validate?: boolean;
  /** `None`, `Apply`, `Force` or `Auto` (provider default: Auto). */
  signature?: 'None' | 'Apply' | 'Force' | 'Auto';
  /**
   * Makes the submission idempotent for 24 hours: retrying with the same key returns the original
   * response instead of creating a second invoice. Strongly recommended; at most 255 characters.
   */
  idempotencyKey?: string;
}

/** Maps `latest_state` / `state` (SDI states as named by Invoicetronic). `null` = not yet sent. */
export function mapInvoicetronicState(state: string | null | undefined): SdiStatus {
  switch (state) {
    case null:
    case undefined:
    case '':
      return 'queued';
    case 'Inviato':
      return 'sent';
    case 'Consegnato':
      return 'delivered';
    case 'Scartato':
      return 'rejected';
    case 'NonConsegnato':
    case 'ImpossibilitaDiRecapito':
    case 'AttestazioneTrasmissioneFattura':
      return 'not-delivered';
    case 'AccettatoDalDestinatario':
      return 'accepted';
    case 'RifiutatoDalDestinatario':
      return 'refused';
    case 'DecorrenzaTermini':
      return 'deadline-expired';
    default:
      return 'unknown';
  }
}

/**
 * Invoicetronic (https://invoicetronic.com/en/docs/). Sends FatturaPA XML as is (`POST /send/xml`).
 * Authentication: HTTP Basic with the API key as user name and an empty password.
 */
export class InvoicetronicProvider implements SdiProvider {
  readonly name = 'invoicetronic';
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

  constructor(options: InvoicetronicProviderOptions) {
    const environment = options.environment ?? 'sandbox';
    const key = options.apiKey;
    const expectedPrefix = environment === 'sandbox' ? 'ik_test_' : 'ik_live_';
    const check = (value: string) => {
      if (!value || /[\r\n:]/.test(value)) throw new FatturaPAError('invoicetronic: invalid API key');
      if (!value.startsWith(expectedPrefix)) {
        throw new FatturaPAError(
          `invoicetronic: the API key does not belong to the ${environment} environment`,
        );
      }
      return value;
    };
    if (typeof key === 'string') check(key);
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl: INVOICETRONIC_BASE_URL,
      authorization: async () => {
        const value = check(typeof key === 'function' ? await key() : key);
        return `Basic ${Buffer.from(`${value}:`).toString('base64')}`;
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
      throw new ProviderError(`invoicetronic: unexpected ${operation} response (HTTP ${response.status})`, {
        provider: this.name,
        operation,
        status: response.status,
      });
    }
    return parsed.data;
  }

  /** Sends an invoice. The returned id is Invoicetronic's numeric send id, as a string. */
  async send(input: SendInvoiceInput, options: InvoicetronicSendOptions = {}): Promise<SendResult> {
    if ((input.xml === undefined) === (input.invoice === undefined))
      throw new RangeError('Pass exactly one of xml and invoice');
    if (options.idempotencyKey !== undefined && !/^[\x21-\x7e]{1,255}$/.test(options.idempotencyKey)) {
      throw new RangeError('idempotencyKey must be 1-255 printable ASCII characters');
    }
    const xml = input.xml ?? buildFatturaXml(input.invoice!);
    const response = await this.#http.send({
      method: 'POST',
      path: '/send/xml',
      query: {
        validate: options.validate ?? true,
        ...(options.signature ? { signature: options.signature } : {}),
      },
      body: xml,
      contentType: 'application/xml',
      ...(options.idempotencyKey ? { headers: { 'idempotency-key': options.idempotencyKey } } : {}),
      operation: 'send',
      ...sig(options),
    });
    const created = this.#parse(send, response, 'send');
    return {
      provider: this.name,
      id: String(created.id),
      status: mapInvoicetronicState(created.latest_state),
    };
  }

  async getSend(
    id: string | number,
    options: CallOptions & { includePayload?: boolean } = {},
  ): Promise<InvoicetronicSend> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/send/${pathSegment(numericId(id))}`,
      ...(options.includePayload ? { query: { include_payload: true } } : {}),
      operation: 'getSend',
      ...sig(options),
    });
    return this.#parse(send, response, 'getSend');
  }

  /** Status updates from the SDI (filter e.g. `{ send_id, unread: true }`). Free of charge. */
  async listUpdates(
    query: {
      send_id?: number;
      unread?: boolean;
      state?: string;
      page?: number;
      page_size?: number;
      company_id?: number;
    } = {},
    options: CallOptions = {},
  ): Promise<InvoicetronicUpdate[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/update',
      query,
      operation: 'listUpdates',
      ...sig(options),
    });
    return this.#parse(z.array(update).max(1000), response, 'listUpdates');
  }

  async getStatus(id: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    const item = await this.getSend(id, options);
    const result: InvoiceStatusResult = {
      provider: this.name,
      id: String(item.id),
      status: mapInvoicetronicState(item.latest_state),
    };
    if (item.latest_state) result.providerStatus = item.latest_state;
    if (item.identifier) result.sdiIdentifier = item.identifier;
    if (item.file_name) result.sdiFileName = item.file_name;
    if (result.status === 'rejected') {
      const updates = await this.listUpdates({ send_id: item.id, state: 'Scartato' }, options).catch(
        () => [],
      );
      const errors = updates.flatMap((u) => u.errors ?? []);
      if (errors.length > 0) {
        result.errors = errors.slice(0, 50).map((e) => ({
          ...(e.code ? { code: e.code } : {}),
          description: redact([e.description, e.hint].filter(Boolean).join(' - ')).slice(0, 1000),
        }));
      }
    }
    return result;
  }

  /** Received (supplier) invoices. With `include_payload`, the XML is returned and the item marked read. */
  async listReceived(
    query: {
      unread?: boolean;
      include_payload?: boolean;
      page?: number;
      page_size?: number;
      company_id?: number;
      q?: string;
    } = {},
    options: CallOptions = {},
  ): Promise<InvoicetronicReceive[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/receive',
      query,
      operation: 'listReceived',
      ...sig(options),
    });
    return this.#parse(z.array(receive).max(1000), response, 'listReceived');
  }

  async getReceived(
    id: number,
    options: CallOptions & { includePayload?: boolean } = {},
  ): Promise<InvoicetronicReceive> {
    const response = await this.#http.send({
      method: 'GET',
      path: `/receive/${pathSegment(id)}`,
      ...(options.includePayload ? { query: { include_payload: true } } : {}),
      operation: 'getReceived',
      ...sig(options),
    });
    return this.#parse(receive, response, 'getReceived');
  }

  /** Decodes a `payload` according to its `encoding` (`Xml` or `Base64`). The result may be a `.p7m`. */
  static decodePayload(item: { payload?: string | null; encoding?: string | null }): Uint8Array {
    if (!item.payload)
      throw new FatturaPAError('invoicetronic: the item has no payload (request it with includePayload)');
    return item.encoding === 'Base64'
      ? new Uint8Array(Buffer.from(item.payload, 'base64'))
      : new TextEncoder().encode(item.payload);
  }

  async listCompanies(options: CallOptions = {}): Promise<InvoicetronicCompany[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/company',
      operation: 'listCompanies',
      ...sig(options),
    });
    return this.#parse(z.array(company).max(10_000), response, 'listCompanies');
  }

  /** Operations and signatures left on the account. */
  async accountStatus(options: CallOptions = {}): Promise<z.infer<typeof status>> {
    const response = await this.#http.send({
      method: 'GET',
      path: '/status',
      operation: 'accountStatus',
      ...sig(options),
    });
    return this.#parse(status, response, 'accountStatus');
  }

  /**
   * Creates a webhook. The response carries the signing `secret` **only this once**: store it in your
   * secret manager and verify every delivery with `verifyInvoicetronicWebhook`.
   */
  async createWebhook(
    input: { url: string; events: readonly InvoicetronicEvent[]; description?: string; companyId?: number },
    options: CallOptions = {},
  ): Promise<InvoicetronicWebhook> {
    if (new URL(input.url).protocol !== 'https:') throw new RangeError('webhook url must be https');
    if (input.events.length === 0 || input.events.some((e) => !INVOICETRONIC_EVENTS.includes(e)))
      throw new RangeError('invalid events');
    const response = await this.#http.send({
      method: 'POST',
      path: '/webhook',
      json: {
        url: input.url,
        events: input.events,
        ...(input.description ? { description: input.description } : {}),
        ...(input.companyId ? { company_id: input.companyId } : {}),
      },
      operation: 'createWebhook',
      ...sig(options),
    });
    return this.#parse(webhook, response, 'createWebhook');
  }

  async deleteWebhook(id: number, options: CallOptions = {}): Promise<void> {
    const response = await this.#http.send({
      method: 'DELETE',
      path: `/webhook/${pathSegment(id)}`,
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

function numericId(id: string | number): string {
  const text = String(id);
  if (!/^\d{1,10}$/.test(text)) throw new RangeError('id must be a numeric Invoicetronic id');
  return text;
}

function sig(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
