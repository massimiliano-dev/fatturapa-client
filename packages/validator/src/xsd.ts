import { assertSafeXml, DEFAULT_MAX_XML_BYTES, redact } from '@massimiliano-dev/fatturapa-core';
import type { XsdSchemaSet } from './schemas.js';
import { DOCUMENT_FILE_NAME, runXmllint } from './xmllint.js';

/** One validation problem. */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  source: 'xsd' | 'rules';
  /** SDI rejection code, when the issue maps to one (rules only). */
  code?: string;
  message: string;
  /** Line in the document (XSD) or element path (rules). */
  line?: number;
  path?: string;
}

export interface ValidationResult {
  /** True when there is no issue of severity `error`. */
  valid: boolean;
  issues: ValidationIssue[];
}

export interface XsdValidatorOptions {
  /** Maximum document size in bytes. Default 5 MiB (the SDI limit). */
  maxInputBytes?: number;
  /** xmllint memory ceiling in 64 KiB WebAssembly pages. Default 256 MiB. */
  maxMemoryPages?: number;
  /** Maximum number of issues returned. Default 100. */
  maxIssues?: number;
}

/**
 * XSD validation with libxml2 compiled to WebAssembly (`xmllint-wasm`): no native build, no access to the
 * host file system, no network (`--nonet`). Inputs pass through `assertSafeXml` first (no DOCTYPE/ENTITY,
 * UTF-8 only, size cap). Messages are redacted because libxml2 quotes invalid values, which can be
 * personal data (names, fiscal codes, IBANs).
 */
export class XsdValidator {
  readonly #schema: XsdSchemaSet;
  readonly #maxInputBytes: number;
  readonly #maxMemoryPages: number | undefined;
  readonly #maxIssues: number;

  constructor(schema: XsdSchemaSet, options: XsdValidatorOptions = {}) {
    for (const file of [schema.entry, ...schema.includes]) {
      if (!/^[\w.-]+(\/[\w.-]+)*$/.test(file.fileName) || file.fileName.split('/').includes('..')) {
        throw new TypeError('Schema file names must be relative paths without ".."');
      }
      if (file.fileName === DOCUMENT_FILE_NAME) throw new TypeError(`"${DOCUMENT_FILE_NAME}" is reserved`);
    }
    this.#schema = schema;
    this.#maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_XML_BYTES;
    this.#maxMemoryPages = options.maxMemoryPages;
    this.#maxIssues = options.maxIssues ?? 100;
  }

  /**
   * Validates a document against the schema.
   *
   * @throws {UnsafeXmlError} if the input is refused before parsing.
   */
  async validate(xml: string | Uint8Array): Promise<ValidationResult> {
    const text = assertSafeXml(xml, { maxBytes: this.#maxInputBytes });
    const result = await runXmllint({
      xml: text,
      schema: this.#schema.entry,
      preload: this.#schema.includes,
      ...(this.#maxMemoryPages === undefined ? {} : { maxMemoryPages: this.#maxMemoryPages }),
    });
    const issues: ValidationIssue[] = result.valid
      ? []
      : documentMessages(result.rawOutput)
          .slice(0, this.#maxIssues)
          .map(({ line, message }) => ({
            severity: 'error' as const,
            source: 'xsd' as const,
            message,
            line,
          }));
    if (!result.valid && issues.length === 0) {
      issues.push({ severity: 'error', source: 'xsd', message: 'Document is not valid against the XSD' });
    }
    return { valid: result.valid, issues };
  }
}

const DOCUMENT_LINE = new RegExp(`^${DOCUMENT_FILE_NAME.replace('.', '\\.')}:(\\d+): (.*)$`);

/**
 * Keeps only xmllint lines about the document (`document.xml:<line>: <message>`). Everything else is
 * dropped on purpose: for well-formedness errors libxml2 prints the offending source line and a caret,
 * which would leak document content.
 */
export function documentMessages(rawOutput: string): { line: number; message: string }[] {
  const out: { line: number; message: string }[] = [];
  for (const raw of rawOutput.split('\n')) {
    const match = DOCUMENT_LINE.exec(raw);
    if (!match) continue;
    const message =
      match[2]?.replace(/^(?:Schemas validity error|parser error|namespace error)\s*:\s*/, '') ?? '';
    out.push({ line: Number(match[1]), message: maskQuotedValues(message) });
  }
  return out;
}

/**
 * Masks the values libxml2 quotes in schema errors (`'Mario' is not a valid value…`); element names are
 * kept because they locate the problem. The result also goes through `redact()`.
 */
export function maskQuotedValues(message: string): string {
  return redact(
    message
      .replace(/'[^']*'(?=\s+is not (?:a valid value|accepted|an element|facet-valid))/g, "'[VALUE]'")
      .replace(/\b([Vv]alue)\s+'[^']*'/g, "$1 '[VALUE]'")
      .replace(/(attribute '[^']*': )'[^']*'/g, "$1'[VALUE]'"),
  );
}
