import {
  FatturaPAError,
  HttpClient,
  pathSegment,
  ProviderError,
  providerErrorFor,
  ProviderValidationError,
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
import { toFicIssuedDocument, type FicMappingOptions } from './mapping.js';
import { FIC_API_BASE_URL } from './oauth.js';
import {
  issuedDocumentResponse,
  listReceivedDocuments,
  listVatTypes,
  rejectionReason,
  sendEInvoiceResponse,
  type subscription,
  subscriptionResponse,
  subscriptionsResponse,
  verifyXmlError,
  verifyXmlResponse,
  type FicEInvoiceStatus,
  type FicIssuedDocument,
  type FicVatType,
} from './schemas.js';

/** Options of {@link FattureInCloudProvider}. */
export interface FattureInCloudProviderOptions {
  /** Company the documents belong to (`GET /user/companies`). */
  companyId: number;
  /**
   * OAuth access token (24 h) or manual token. Prefer a function that returns a fresh token from your
   * store (refresh it with `refreshFicTokens` before `expiresAt`).
   */
  accessToken: string | (() => string | Promise<string>);
  timeoutMs?: number;
  maxResponseBytes?: number;
  dispatcher?: Dispatcher;
}

/** Options of {@link FattureInCloudProvider.send}. */
export interface FicSendOptions extends CallOptions, FicMappingOptions {
  /** Run Fatture in Cloud's XML check before sending and stop on errors. Default true. */
  verifyXml?: boolean;
  /** Create and verify the document but do not send it to the SDI. */
  dryRun?: boolean;
}

/**
 * Maps the `ei_status` of an issued document (openapi-fattureincloud IssuedDocument.ei_status) to the
 * normalised status.
 */
export function mapFicEInvoiceStatus(status: string | null | undefined): SdiStatus {
  switch (status as FicEInvoiceStatus | undefined) {
    case 'not_sent':
      return 'draft';
    case 'attempt':
    case 'pending':
      return 'queued';
    case 'sent':
    case 'processing':
      return 'sent';
    case 'discarded':
      return 'rejected';
    case 'not_delivered':
      return 'not-delivered';
    case 'accepted':
    case 'manual_accepted':
      return 'accepted';
    case 'rejected':
    case 'manual_rejected':
      return 'refused';
    case 'no_response':
      return 'deadline-expired';
    case 'error':
      return 'error';
    default:
      return 'unknown';
  }
}

/**
 * Fatture in Cloud API v2 (https://developers.fattureincloud.it). Fatture in Cloud is a full invoicing
 * application: it stores the document, generates the FatturaPA XML and sends it to the SDI. So `send`
 * takes the typed model (mapped with {@link toFicIssuedDocument}), not raw XML.
 *
 * Rate limits (developers.fattureincloud.it/docs/basics/limits-and-quotas): 300 requests / 5 minutes per
 * company (429, retried for GETs), 1,000 / hour and 40,000 / month per company-app (403 with Retry-After).
 */
export class FattureInCloudProvider implements SdiProvider {
  readonly name = 'fattureincloud';
  readonly capabilities: ProviderCapabilities = {
    sendXml: false,
    sendModel: true,
    signature: true,
    receive: true,
    notifications: false,
    webhooks: true,
    sandbox: false,
  };
  readonly companyId: number;
  readonly #http: HttpClient;
  #vatTypes: Promise<FicVatType[]> | undefined;

  constructor(options: FattureInCloudProviderOptions) {
    if (!Number.isSafeInteger(options.companyId) || options.companyId <= 0)
      throw new RangeError('companyId must be a positive integer');
    this.companyId = options.companyId;
    const token = options.accessToken;
    this.#http = new HttpClient({
      provider: this.name,
      baseUrl: FIC_API_BASE_URL,
      authorization: async () => {
        const value = typeof token === 'function' ? await token() : token;
        if (!value || /[\r\n]/.test(value)) throw new FatturaPAError('fattureincloud: invalid access token');
        return `Bearer ${value}`;
      },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
      ...(options.dispatcher === undefined ? {} : { dispatcher: options.dispatcher }),
      userAgent: 'fatturapa-client (+https://github.com/massimiliano-dev/fatturapa-client)',
    });
  }

  #path(rest: string): string {
    return `/c/${pathSegment(this.companyId)}${rest}`;
  }

  #parse<T extends z.ZodTypeAny>(schema: T, response: HttpResponse, operation: string): z.infer<T> {
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, operation, response);
    const parsed = schema.safeParse(response.json());
    if (!parsed.success) {
      throw new ProviderError(`fattureincloud: unexpected ${operation} response (HTTP ${response.status})`, {
        provider: this.name,
        operation,
        status: response.status,
      });
    }
    return parsed.data;
  }

  /** The company's VAT types (cached for the lifetime of the provider). */
  async listVatTypes(options: CallOptions = {}): Promise<FicVatType[]> {
    this.#vatTypes ??= this.#http
      .send({
        method: 'GET',
        path: this.#path('/info/vat_types'),
        operation: 'listVatTypes',
        ...sig(options),
      })
      .then((r) => this.#parse(listVatTypes, r, 'listVatTypes').data ?? []);
    try {
      return await this.#vatTypes;
    } catch (error) {
      this.#vatTypes = undefined;
      throw error;
    }
  }

  /** Creates an issued document from a raw Fatture in Cloud body (`data` of CreateIssuedDocumentRequest). */
  async createIssuedDocument(
    data: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<FicIssuedDocument> {
    const response = await this.#http.send({
      method: 'POST',
      path: this.#path('/issued_documents'),
      json: { data },
      operation: 'createIssuedDocument',
      ...sig(options),
    });
    const doc = this.#parse(issuedDocumentResponse, response, 'createIssuedDocument').data;
    if (!doc)
      throw new ProviderError('fattureincloud: create response has no document', {
        provider: this.name,
        operation: 'createIssuedDocument',
        status: response.status,
      });
    return doc;
  }

  async getIssuedDocument(id: number, options: CallOptions = {}): Promise<FicIssuedDocument> {
    const response = await this.#http.send({
      method: 'GET',
      path: this.#path(`/issued_documents/${pathSegment(id)}`),
      query: { fieldset: 'detailed' },
      operation: 'getIssuedDocument',
      ...sig(options),
    });
    const doc = this.#parse(issuedDocumentResponse, response, 'getIssuedDocument').data;
    if (!doc)
      throw new ProviderError('fattureincloud: document not found in response', {
        provider: this.name,
        operation: 'getIssuedDocument',
        status: response.status,
      });
    return doc;
  }

  /** Fatture in Cloud's own XML check. Returns the problems found (empty if the XML is valid). */
  async verifyEInvoiceXml(id: number, options: CallOptions = {}): Promise<string[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: this.#path(`/issued_documents/${pathSegment(id)}/e_invoice/xml_verify`),
      operation: 'verifyEInvoiceXml',
      ...sig(options),
    });
    if (response.status === 422) {
      const parsed = verifyXmlError.safeParse(response.json());
      const errors = parsed.success
        ? [...(parsed.data.error?.validation_result?.xml_errors ?? []), ...(parsed.data.extra?.errors ?? [])]
        : [];
      const message = parsed.success ? parsed.data.error?.message : undefined;
      const out = (errors.length > 0 ? errors : [message ?? 'XML not valid']).map((e) =>
        redact(e).slice(0, 1000),
      );
      return out;
    }
    const ok = this.#parse(verifyXmlResponse, response, 'verifyEInvoiceXml').data?.success;
    return ok === false ? ['XML not valid'] : [];
  }

  /** Sends an existing issued document to the SDI. */
  async sendEInvoice(
    id: number,
    options: CallOptions & { dryRun?: boolean } = {},
  ): Promise<{ name?: string; date?: string }> {
    const response = await this.#http.send({
      method: 'POST',
      path: this.#path(`/issued_documents/${pathSegment(id)}/e_invoice/send`),
      json: { data: {}, ...(options.dryRun ? { options: { dry_run: true } } : {}) },
      operation: 'sendEInvoice',
      ...sig(options),
    });
    const data = this.#parse(sendEInvoiceResponse, response, 'sendEInvoice').data ?? {};
    return { ...(data.name ? { name: data.name } : {}), ...(data.date ? { date: data.date } : {}) };
  }

  /** The XML generated by Fatture in Cloud. Personal data: never log it. */
  async getEInvoiceXml(
    id: number,
    options: CallOptions & { includeAttachment?: boolean } = {},
  ): Promise<string> {
    const response = await this.#http.send({
      method: 'GET',
      path: this.#path(`/issued_documents/${pathSegment(id)}/e_invoice/xml`),
      accept: 'application/xml, text/plain, application/json',
      ...(options.includeAttachment ? { query: { include_attachment: true } } : {}),
      operation: 'getEInvoiceXml',
      ...sig(options),
    });
    if (response.status !== 200) throw providerErrorFor(this.name, 'getEInvoiceXml', response);
    return response.text();
  }

  /** Why the SDI rejected the invoice (NS), with Fatture in Cloud's suggested solution. */
  async getRejectionReason(
    id: number,
    options: CallOptions = {},
  ): Promise<z.infer<typeof rejectionReason>['data']> {
    const response = await this.#http.send({
      method: 'GET',
      path: this.#path(`/issued_documents/${pathSegment(id)}/e_invoice/error_reason`),
      operation: 'getRejectionReason',
      ...sig(options),
    });
    return this.#parse(rejectionReason, response, 'getRejectionReason').data;
  }

  /**
   * Maps the invoice, creates the document, optionally runs the XML check, then sends it to the SDI.
   * If the check fails the document stays as a draft and a {@link ProviderValidationError} lists the
   * problems; `id` is in `error.details.messages[0]` as `document <id>`. Never retried automatically.
   */
  async send(input: SendInvoiceInput, options: FicSendOptions = {}): Promise<SendResult> {
    if (input.xml !== undefined || input.invoice === undefined) {
      throw new RangeError('Fatture in Cloud generates the XML itself: pass `invoice`, not `xml`');
    }
    const data = toFicIssuedDocument(input.invoice, await this.listVatTypes(options), options);
    const doc = await this.createIssuedDocument(data, options);
    if (options.verifyXml !== false) {
      const problems = await this.verifyEInvoiceXml(doc.id, options);
      if (problems.length > 0) {
        throw new ProviderValidationError(
          `fattureincloud: XML check failed for document ${doc.id}: ${problems.slice(0, 3).join('; ')}`,
          {
            provider: this.name,
            operation: 'verifyEInvoiceXml',
            messages: [`document ${doc.id}`, ...problems],
          },
        );
      }
    }
    if (options.dryRun) return { provider: this.name, id: String(doc.id), status: 'draft' };
    await this.sendEInvoice(doc.id, options);
    return { provider: this.name, id: String(doc.id), status: 'queued' };
  }

  async getStatus(id: string, options: CallOptions = {}): Promise<InvoiceStatusResult> {
    if (!/^\d{1,18}$/.test(id)) throw new RangeError('id must be a Fatture in Cloud document id');
    const doc = await this.getIssuedDocument(Number(id), options);
    const status = mapFicEInvoiceStatus(doc.ei_status);
    const result: InvoiceStatusResult = { provider: this.name, id, status };
    if (doc.ei_status) result.providerStatus = doc.ei_status;
    if (status === 'rejected' || status === 'error') {
      const reason = await this.getRejectionReason(Number(id), options).catch(() => undefined);
      if (reason?.reason)
        result.errors = [
          {
            ...(reason.code ? { code: reason.code } : {}),
            description: redact(reason.reason).slice(0, 1000),
          },
        ];
    }
    return result;
  }

  /** Received documents (e.g. `{ type: 'expense' }`), paginated as in the API. */
  async listReceivedDocuments(
    query: {
      type: 'expense' | 'passive_credit_note' | 'passive_delivery_note';
      page?: number;
      per_page?: number;
      q?: string;
    },
    options: CallOptions = {},
  ): Promise<z.infer<typeof listReceivedDocuments>> {
    const response = await this.#http.send({
      method: 'GET',
      path: this.#path('/received_documents'),
      query,
      operation: 'listReceivedDocuments',
      ...sig(options),
    });
    return this.#parse(listReceivedDocuments, response, 'listReceivedDocuments');
  }

  /**
   * Creates a webhook subscription. The sink must be HTTPS and answer the verification request with
   * `handleFicVerification`. One subscription per app and event type.
   */
  async createSubscription(
    input: {
      sink: string;
      types: readonly string[];
      mapping?: 'binary' | 'structured';
      verificationMethod?: 'header' | 'query';
    },
    options: CallOptions = {},
  ): Promise<z.infer<typeof subscription>> {
    if (new URL(input.sink).protocol !== 'https:') throw new RangeError('sink must be an https URL');
    if (input.types.length === 0 || input.types.some((t) => !t.startsWith('it.fattureincloud.webhooks.')))
      throw new RangeError('invalid event types');
    const response = await this.#http.send({
      method: 'POST',
      path: this.#path('/subscriptions'),
      json: {
        data: {
          sink: input.sink,
          types: input.types,
          verification_method: input.verificationMethod ?? 'header',
          config: { mapping: input.mapping ?? 'binary' },
        },
      },
      operation: 'createSubscription',
      ...sig(options),
    });
    return this.#parse(subscriptionResponse, response, 'createSubscription').data ?? {};
  }

  async listSubscriptions(options: CallOptions = {}): Promise<z.infer<typeof subscription>[]> {
    const response = await this.#http.send({
      method: 'GET',
      path: this.#path('/subscriptions'),
      operation: 'listSubscriptions',
      ...sig(options),
    });
    return this.#parse(subscriptionsResponse, response, 'listSubscriptions').data ?? [];
  }

  /** Asks Fatture in Cloud to repeat the sink verification (at most 5 attempts per subscription). */
  async verifySubscription(subscriptionId: string, options: CallOptions = {}): Promise<void> {
    const response = await this.#http.send({
      method: 'POST',
      path: this.#path(`/subscriptions/${pathSegment(subscriptionId)}/verify`),
      json: { data: {} },
      operation: 'verifySubscription',
      ...sig(options),
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'verifySubscription', response);
  }

  async deleteSubscription(subscriptionId: string, options: CallOptions = {}): Promise<void> {
    const response = await this.#http.send({
      method: 'DELETE',
      path: this.#path(`/subscriptions/${pathSegment(subscriptionId)}`),
      operation: 'deleteSubscription',
      ...sig(options),
    });
    if (response.status < 200 || response.status >= 300)
      throw providerErrorFor(this.name, 'deleteSubscription', response);
  }

  async close(): Promise<void> {
    await this.#http.close();
  }
}

function sig(options: CallOptions): { signal?: AbortSignal } {
  return options.signal ? { signal: options.signal } : {};
}
