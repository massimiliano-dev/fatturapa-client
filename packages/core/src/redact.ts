/**
 * Redaction of secrets and personal data before anything is logged, printed or put into an error message.
 *
 * Invoices carry personal data (natural persons' names, fiscal codes, addresses, IBANs, PEC addresses) and
 * provider credentials are bearer tokens: a leaked token lets anyone issue invoices in the owner's name.
 * The rules are deliberately greedy: a false positive costs a less useful log line, a false negative can be
 * a data breach. Every error message produced by the fatturapa packages passes through {@link redact}.
 */

/** Placeholder written in place of a compact JWS/JWT. */
export const REDACTED_JWT = '[REDACTED:JWT]';
/** Placeholder written in place of a codice fiscale (Italian fiscal code of a natural person). */
export const REDACTED_CF = '[REDACTED:CF]';
/** Placeholder written in place of an IBAN. */
export const REDACTED_IBAN = '[REDACTED:IBAN]';
/** Placeholder written in place of an Italian VAT number with its country prefix. */
export const REDACTED_VAT = '[REDACTED:VAT]';
/** Placeholder written in place of an e-mail or PEC address. */
export const REDACTED_EMAIL = '[REDACTED:EMAIL]';
/** Placeholder written in place of a PEM block (keys, certificates). */
export const REDACTED_PEM = '[REDACTED:PEM]';
/** Placeholder written in place of an invoice or any other XML document. */
export const REDACTED_XML = '[REDACTED:XML]';
/** Placeholder written in place of long base64 blobs (attachments, signed files, certificates). */
export const REDACTED_BASE64 = '[REDACTED:BASE64]';
/** Placeholder written in place of any other secret value. */
export const REDACTED = '[REDACTED]';

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g;

// Compact JWS: three base64url segments; the header of every JWT starts with `{"` = `eyJ`.
const JWT = /\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/g;

// `Authorization: Bearer xxx`, `Basic xxx`, and `token=xxx` / `"access_token":"xxx"` style pairs.
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_PAIR =
  /\b((?:access|refresh|id)?_?token|client_secret|api_?key|apikey|password|secret)("?\s*[:=]\s*"?)[^\s"&,;}]+/gi;

/**
 * Codice fiscale of a natural person, including "omocodia" (digits replaced by LMNPQRSTUV). The month
 * position is restricted to the real month letters so that 16-letter XML names are not masked.
 */
const OMO = '[0-9LMNPQRSTUV]';
const CODICE_FISCALE = new RegExp(
  `(?<![A-Za-z0-9])[A-Z]{6}${OMO}{2}[ABCDEHLMPRST]${OMO}{2}[A-Z]${OMO}{3}[A-Z](?![A-Za-z0-9])`,
  'gi',
);

// IBAN (ISO 13616): two letters, two check digits, 11-30 alphanumerics; optional groups of four.
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g;

// Italian VAT number with the country prefix, as in IdFiscaleIVA and SDI file names (IT01234567890_…).
const VAT_IT = /(?<![A-Za-z0-9])IT\d{11}(?!\d)/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// A whole invoice (or any XML document with a prolog) is never useful in a log.
const INVOICE_DOCUMENT =
  /<(?:[A-Za-z_][\w.-]*:)?FatturaElettronica(?:Semplificata)?\b[\s\S]*?(?:<\/(?:[A-Za-z_][\w.-]*:)?FatturaElettronica(?:Semplificata)?>|$)/g;
const XML_DOCUMENT = /<\?xml[\s\S]*$/g;

// Base64 runs longer than 200 characters: attachments, CAdES envelopes, certificates.
const LONG_BASE64 = /[A-Za-z0-9+/]{200,}={0,2}/g;

/**
 * Masks tokens and credentials, PEM blocks, invoice/XML documents, long base64 blobs, fiscal codes, IBANs,
 * `IT` VAT numbers and e-mail addresses in a string.
 *
 * VAT numbers without the `IT` prefix are not masked: they are indistinguishable from other 11-digit
 * numbers (SDI identifiers, phone numbers). Mask them yourself if they identify sole traders in your logs.
 */
export function redact(input: string): string {
  return input
    .replace(PEM_BLOCK, REDACTED_PEM)
    .replace(INVOICE_DOCUMENT, REDACTED_XML)
    .replace(XML_DOCUMENT, REDACTED_XML)
    .replace(JWT, REDACTED_JWT)
    .replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(TOKEN_PAIR, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(LONG_BASE64, REDACTED_BASE64)
    .replace(EMAIL, REDACTED_EMAIL)
    .replace(IBAN, (match) => {
      const compact = match.replace(/ /g, '');
      return compact.length >= 15 && compact.length <= 34 && /\d/.test(compact.slice(4))
        ? REDACTED_IBAN
        : match;
    })
    .replace(VAT_IT, REDACTED_VAT)
    .replace(CODICE_FISCALE, REDACTED_CF);
}

/**
 * Object keys whose values are always replaced, whatever their content. Compared case-insensitively, with
 * `-` and `_` ignored.
 */
const SENSITIVE_KEYS = new Set(
  [
    'authorization',
    'cookie',
    'set-cookie',
    'token',
    'access_token',
    'refresh_token',
    'accesstoken',
    'refreshtoken',
    'client_secret',
    'apikey',
    'api_key',
    'jwt',
    'key',
    'privatekey',
    'passphrase',
    'password',
    'secret',
    'codicefiscale',
    'codice_fiscale',
    'fiscalcode',
    'tax_code',
    'iban',
    'xml',
    'payload',
    'attachment',
    'file',
    'body',
  ].map(normalizeKey),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Deep-redacts a value for structured logging: sensitive keys are replaced entirely, strings go through
 * {@link redact}, binary data is replaced by its length. Cycles are cut and depth is bounded.
 */
export function redactValue(value: unknown): unknown {
  return redactInner(value, new WeakSet(), 0);
}

function redactInner(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (depth > 32) return '[Too deep]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactInner(item, seen, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(normalizeKey(k)) ? REDACTED : redactInner(v, seen, depth + 1);
  }
  return out;
}
