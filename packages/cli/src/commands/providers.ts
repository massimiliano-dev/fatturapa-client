import { FatturaPAError, type SdiProvider } from '@massimiliano-dev/fatturapa-core';
import { FattureInCloudProvider } from '@massimiliano-dev/fatturapa-fattureincloud';
import { OpenapiItProvider } from '@massimiliano-dev/fatturapa-openapi-it';
import type { CliIo } from '../io.js';
import { readInvoiceFile } from '../input.js';
import { ExitCode } from '../io.js';
import { validateInvoice } from './validate.js';

export interface ProviderOptions {
  provider: 'openapi-it' | 'fattureincloud';
  env?: 'sandbox' | 'production';
  company?: string;
  confirmProduction?: boolean;
}

/**
 * Credentials come only from environment variables, never from flags (flags end up in shell history
 * and process listings): OPENAPI_IT_TOKEN for Openapi.it, FIC_ACCESS_TOKEN for Fatture in Cloud.
 */
export function createProvider(io: CliIo, options: ProviderOptions): SdiProvider {
  if (options.provider === 'openapi-it') {
    const env = options.env ?? 'sandbox';
    if (env === 'production' && !options.confirmProduction) {
      throw new FatturaPAError('Refusing to use production without --confirm-production');
    }
    const token = io.env.OPENAPI_IT_TOKEN;
    if (!token) throw new FatturaPAError('Set OPENAPI_IT_TOKEN in the environment');
    return new OpenapiItProvider({ environment: env, token });
  }
  const token = io.env.FIC_ACCESS_TOKEN;
  if (!token) throw new FatturaPAError('Set FIC_ACCESS_TOKEN in the environment');
  if (!options.confirmProduction) {
    throw new FatturaPAError(
      'Fatture in Cloud has no sandbox: pass --confirm-production to act on the real company',
    );
  }
  const company = Number(options.company ?? io.env.FIC_COMPANY_ID);
  if (!Number.isSafeInteger(company) || company <= 0)
    throw new FatturaPAError('Pass --company or set FIC_COMPANY_ID');
  return new FattureInCloudProvider({ companyId: company, accessToken: token });
}

export async function sendCommand(
  io: CliIo,
  file: string,
  options: ProviderOptions & {
    schemas?: string;
    validate?: boolean;
    dryRun?: boolean;
    signature?: boolean;
    legalStorage?: boolean;
    today?: string;
  },
): Promise<number> {
  if (options.provider !== 'openapi-it') {
    throw new FatturaPAError(
      'Sending an XML file is supported with --provider openapi-it (Fatture in Cloud builds its own XML)',
    );
  }
  if (options.validate !== false) {
    const result = await validateInvoice(io, file, {
      ...(options.schemas ? { schemas: options.schemas } : {}),
      ...(options.today ? { today: options.today } : {}),
    });
    if (!result.valid) {
      io.stderr(
        `Not sent: the invoice is not valid (${result.issues.length} issue(s)). Run "fatturapa validate ${file}".\n`,
      );
      return ExitCode.invalid;
    }
  }
  const { xml, wasP7m } = await readInvoiceFile(file);
  if (wasP7m) throw new FatturaPAError('Send the unsigned XML: use --signature to let the provider sign it');
  if (options.dryRun) {
    io.stdout(
      `DRY RUN: ${file} (${xml.byteLength} bytes) would be sent to ${options.provider} ${options.env ?? 'sandbox'}${options.signature ? ' with signature' : ''}${options.legalStorage ? ' and legal storage' : ''}\n`,
    );
    return ExitCode.ok;
  }
  const provider = createProvider(io, options) as OpenapiItProvider;
  try {
    const result = await provider.send(
      { xml },
      {
        ...(options.signature ? { signature: true } : {}),
        ...(options.legalStorage ? { legalStorage: true } : {}),
      },
    );
    io.stdout(`${JSON.stringify(result)}\n`);
    return ExitCode.ok;
  } finally {
    await provider.close();
  }
}

export async function statusCommand(io: CliIo, id: string, options: ProviderOptions): Promise<number> {
  const provider = createProvider(io, options);
  try {
    const result = await provider.getStatus(id);
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'rejected' || result.status === 'refused' || result.status === 'error'
      ? ExitCode.invalid
      : ExitCode.ok;
  } finally {
    await provider.close();
  }
}
