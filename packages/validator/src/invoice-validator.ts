import {
  checkBusinessRules,
  FatturaPAParseError,
  parseFatturaXml,
  type BusinessRuleOptions,
} from '@massimiliano-dev/fatturapa-core';
import { loadFatturaPASchema } from './schemas.js';
import {
  XsdValidator,
  type ValidationIssue,
  type ValidationResult,
  type XsdValidatorOptions,
} from './xsd.js';

/**
 * Full local check of an invoice XML: the official XSD first, then the SDI content rules of
 * `checkBusinessRules` (only if the XSD passes, as the SDI does).
 */
export class FatturaPAValidator {
  constructor(private readonly xsd: XsdValidator) {}

  async validate(xml: string | Uint8Array, options: BusinessRuleOptions = {}): Promise<ValidationResult> {
    const xsdResult = await this.xsd.validate(xml);
    if (!xsdResult.valid) return xsdResult;
    let issues: ValidationIssue[];
    try {
      issues = checkBusinessRules(parseFatturaXml(xml), options).map((i) => ({
        severity: i.severity,
        source: 'rules' as const,
        code: i.code,
        message: i.message,
        path: i.path,
      }));
    } catch (error) {
      if (error instanceof FatturaPAParseError) {
        return { valid: false, issues: [{ severity: 'error', source: 'rules', message: error.message }] };
      }
      throw error;
    }
    return { valid: !issues.some((i) => i.severity === 'error'), issues };
  }
}

/** Builds a {@link FatturaPAValidator} from the folder written by `pnpm sync:schemas`. */
export async function createFatturaPAValidator(
  schemasDir: string,
  options: XsdValidatorOptions = {},
): Promise<FatturaPAValidator> {
  return new FatturaPAValidator(new XsdValidator(await loadFatturaPASchema(schemasDir, 'fattura'), options));
}

/** Builds an XSD validator for SDI notifications (`messaggi-pa` or `messaggi-b2b`). */
export async function createNotificationValidator(
  schemasDir: string,
  kind: 'messaggi-pa' | 'messaggi-b2b',
  options: XsdValidatorOptions = {},
): Promise<XsdValidator> {
  return new XsdValidator(await loadFatturaPASchema(schemasDir, kind), {
    maxInputBytes: 1024 * 1024,
    ...options,
  });
}
