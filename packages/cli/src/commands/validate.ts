import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkBusinessRules, parseFatturaXml } from '@massimiliano-dev/fatturapa-core';
import {
  createFatturaPAValidator,
  DEFAULT_SCHEMAS_DIR,
  type ValidationResult,
} from '@massimiliano-dev/fatturapa-validator';
import { readInvoiceFile } from '../input.js';
import { ExitCode, type CliIo } from '../io.js';

export interface ValidateOptions {
  schemas?: string;
  rulesOnly?: boolean;
  today?: string;
  json?: boolean;
}

export function schemasDir(io: CliIo, option: string | undefined): string {
  return resolve(io.cwd, option ?? io.env.FATTURAPA_SCHEMAS_DIR ?? DEFAULT_SCHEMAS_DIR);
}

export async function validateInvoice(
  io: CliIo,
  file: string,
  options: ValidateOptions,
): Promise<ValidationResult> {
  const { xml } = await readInvoiceFile(file);
  const today = options.today;
  if (options.rulesOnly) {
    const issues = checkBusinessRules(parseFatturaXml(xml), today ? { today } : {}).map((i) => ({
      severity: i.severity,
      source: 'rules' as const,
      code: i.code,
      message: i.message,
      path: i.path,
    }));
    return { valid: !issues.some((i) => i.severity === 'error'), issues };
  }
  const dir = schemasDir(io, options.schemas);
  if (!existsSync(dir)) {
    throw new Error(
      `Schemas folder not found (${dir}). Run "pnpm sync:schemas", pass --schemas, or use --rules-only.`,
    );
  }
  const validator = await createFatturaPAValidator(dir);
  return validator.validate(xml, today ? { today } : {});
}

export async function validateCommand(io: CliIo, file: string, options: ValidateOptions): Promise<number> {
  const result = await validateInvoice(io, file, options);
  if (options.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout(`${result.valid ? 'VALID' : 'INVALID'}: ${file} (${result.issues.length} issue(s))\n`);
    for (const issue of result.issues) {
      const where = issue.line !== undefined ? `line ${issue.line}` : (issue.path ?? '');
      io.stdout(
        `  [${issue.severity}] ${issue.source}${issue.code ? ` ${issue.code}` : ''} ${where}: ${issue.message}\n`,
      );
    }
  }
  return result.valid ? ExitCode.ok : ExitCode.invalid;
}
