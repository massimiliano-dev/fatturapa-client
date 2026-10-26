import type { FatturaElettronica } from './model.js';
import type { SdiNotificationType } from './notifications.js';

/** Outcome chosen by a public administration: EC01 accepted, EC02 refused. */
export type EsitoCommittente = 'EC01' | 'EC02';

/**
 * Lifecycle of an outgoing invoice, normalised across providers:
 * - `draft`: stored at the provider, not yet sent;
 * - `queued`: accepted by the provider, not yet transmitted to the SDI;
 * - `sent`: transmitted, waiting for the SDI outcome;
 * - `rejected`: NS, the SDI refused the file (the invoice is considered not issued);
 * - `delivered`: RC, delivered to the recipient (B2B: final);
 * - `not-delivered`: MC/AT, not deliverable; the invoice is issued and available in the recipient's
 *   reserved area ("cassetto fiscale");
 * - `accepted` / `refused`: NE EC01 / EC02 by a public administration;
 * - `deadline-expired`: DT, no PA outcome within 15 days;
 * - `error`: provider-side failure before or during transmission;
 * - `unknown`: a provider status this library does not recognise (see `providerStatus`).
 */
export type SdiStatus =
  | 'draft'
  | 'queued'
  | 'sent'
  | 'rejected'
  | 'delivered'
  | 'not-delivered'
  | 'accepted'
  | 'refused'
  | 'deadline-expired'
  | 'error'
  | 'unknown';

/** True for statuses after which the SDI will not change the invoice any more. */
export function isFinalStatus(status: SdiStatus): boolean {
  return ['rejected', 'delivered', 'accepted', 'refused', 'deadline-expired'].includes(status);
}

/** Maps an SDI notification to the status it implies for the invoice it refers to. */
export function statusFromNotification(type: SdiNotificationType, esito?: EsitoCommittente): SdiStatus {
  switch (type) {
    case 'RC':
      return 'delivered';
    case 'NS':
      return 'rejected';
    case 'MC':
    case 'AT':
      return 'not-delivered';
    case 'NE':
      return esito === 'EC02' ? 'refused' : esito === 'EC01' ? 'accepted' : 'unknown';
    case 'DT':
      return 'deadline-expired';
    default:
      return 'unknown';
  }
}

/** What a provider adapter supports. */
export interface ProviderCapabilities {
  /** Accepts a FatturaPA XML produced by this library (or by you). */
  sendXml: boolean;
  /** Accepts the typed model (it may map it to the provider's own document model). */
  sendModel: boolean;
  /** Can apply a qualified electronic signature before sending. */
  signature: boolean;
  /** Can list or deliver received (supplier) invoices. */
  receive: boolean;
  /** Exposes the SDI notifications of an outgoing invoice. */
  notifications: boolean;
  /** Pushes events to a webhook, verifiable with this library. */
  webhooks: boolean;
  /** Has a sandbox/test environment. */
  sandbox: boolean;
}

/** Input of {@link SdiProvider.send}: exactly one of `xml` and `invoice`. */
export interface SendInvoiceInput {
  /** A FatturaPA XML document (unsigned, UTF-8). */
  xml?: string | Uint8Array;
  /** A typed invoice. Adapters with `sendXml` serialise it with `buildFatturaXml`. */
  invoice?: FatturaElettronica;
}

/** Result of a successful send: the provider accepted the request. It does NOT mean the SDI accepted it. */
export interface SendResult {
  provider: string;
  /** Provider identifier of the outgoing invoice, used by {@link SdiProvider.getStatus}. */
  id: string;
  status: SdiStatus;
}

/** An error reported for an invoice (SDI rejection or provider validation). */
export interface InvoiceError {
  code?: string;
  description: string;
}

/** Status of an outgoing invoice. Free text is redacted. */
export interface InvoiceStatusResult {
  provider: string;
  id: string;
  status: SdiStatus;
  /** The provider's own status value, for diagnostics. */
  providerStatus?: string;
  /** IdentificativoSdI assigned by the SDI, when known. */
  sdiIdentifier?: string;
  /** Name of the file transmitted to the SDI, when known. */
  sdiFileName?: string;
  errors?: InvoiceError[];
}

/** Options accepted by every provider call. */
export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * Common interface of SDI intermediaries. Each adapter also exposes provider-specific methods (OAuth,
 * webhooks, received invoices); use those for features outside this interface.
 */
export interface SdiProvider {
  /** Stable provider name, e.g. `fattureincloud`, `openapi-it`. */
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /** Sends an invoice to the SDI through the provider. Never retried automatically: check the status first. */
  send(input: SendInvoiceInput, options?: CallOptions): Promise<SendResult>;
  /** Current status of an outgoing invoice. */
  getStatus(id: string, options?: CallOptions): Promise<InvoiceStatusResult>;
  /** Releases connections. */
  close(): Promise<void>;
}
