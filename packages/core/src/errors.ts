import { redact } from './redact.js';

/**
 * Base class of every error thrown by the fatturapa packages. The message is always passed through
 * {@link redact}, so tokens, keys, fiscal codes, IBANs and invoice bodies cannot leak through
 * `error.message`, `error.stack` or `JSON.stringify(error)`.
 */
export class FatturaPAError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(
      redact(message),
      options?.cause === undefined ? undefined : { cause: sanitizeCause(options.cause) },
    );
    this.name = new.target.name;
  }

  /** Safe serialisation for structured loggers. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message };
  }
}

/**
 * Keeps only the type, code and redacted message of an underlying error. Library errors (sockets, TLS,
 * parsers) can embed request data in their message or properties, so the original object is never attached.
 */
function sanitizeCause(cause: unknown): Error {
  if (cause instanceof Error) {
    const safe = new Error(redact(cause.message));
    safe.name = cause.name;
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') (safe as Error & { code?: string }).code = code;
    safe.stack = `${safe.name}: ${safe.message}`;
    return safe;
  }
  return new Error('non-Error cause');
}

/** Reason an XML document was refused before parsing. */
export type UnsafeXmlReason = 'too-large' | 'encoding' | 'doctype';

/** Thrown when an XML input is refused before any parsing happens. */
export class UnsafeXmlError extends FatturaPAError {
  constructor(
    readonly reason: UnsafeXmlReason,
    message: string,
  ) {
    super(message);
  }
}

/** The input is well-formed XML but is not a FatturaPA document or SDI notification this library understands. */
export class FatturaPAParseError extends FatturaPAError {}

/** The invoice model cannot be serialised: a required element is missing or a value breaks an XSD facet. */
export class FatturaPAModelError extends FatturaPAError {
  constructor(
    /** Path of the offending element, e.g. `FatturaElettronicaBody[0].DatiBeniServizi.DettaglioLinee[2].PrezzoUnitario`. */
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

/** Thrown by API methods that are typed but not implemented yet in this release. */
export class NotImplementedError extends FatturaPAError {
  constructor(readonly feature: string) {
    super(`${feature} is not implemented yet in this release of fatturapa-client`);
  }
}
