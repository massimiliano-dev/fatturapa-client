import { createHash } from 'node:crypto';
import { FatturaPAError, type SdiProvider } from '@massimiliano-dev/fatturapa-core';
import { AcubeProvider } from '@massimiliano-dev/fatturapa-acube';
import { ArubaProvider } from '@massimiliano-dev/fatturapa-aruba';
import { FatturaElettronicaApiProvider } from '@massimiliano-dev/fatturapa-fattura-elettronica-api';
import { FattureInCloudProvider } from '@massimiliano-dev/fatturapa-fattureincloud';
import { InvoicetronicProvider } from '@massimiliano-dev/fatturapa-invoicetronic';
import { KeliwebProvider } from '@massimiliano-dev/fatturapa-keliweb';
import { OpenapiItProvider } from '@massimiliano-dev/fatturapa-openapi-it';
import type { CliIo } from '../io.js';
import { readInvoiceFile } from '../input.js';
import { ExitCode } from '../io.js';
import { validateInvoice } from './validate.js';

/** Providers that accept a FatturaPA XML file as is. */
export const XML_PROVIDERS = [
  'openapi-it',
  'invoicetronic',
  'acube',
  'fattura-elettronica-api',
  'aruba',
  'keliweb',
] as const;
export const PROVIDERS = [...XML_PROVIDERS, 'fattureincloud'] as const;

export interface ProviderOptions {
  provider: (typeof PROVIDERS)[number];
  env?: 'sandbox' | 'production';
  company?: string;
  confirmProduction?: boolean;
}

function required(io: CliIo, ...names: string[]): string[] {
  const values = names.map((n) => io.env[n]);
  const missing = names.filter((_, i) => !values[i]);
  if (missing.length > 0) throw new FatturaPAError(`Set ${missing.join(' and ')} in the environment`);
  return values as string[];
}

/**
 * Credentials come only from environment variables, never from flags (flags end up in shell history
 * and process listings). See `fatturapa send --help` for the variable names.
 */
export function createProvider(io: CliIo, options: ProviderOptions): SdiProvider {
  const env = options.env ?? 'sandbox';
  if (env === 'production' && !options.confirmProduction) {
    throw new FatturaPAError('Refusing to use production without --confirm-production');
  }
  switch (options.provider) {
    case 'openapi-it': {
      const [token] = required(io, 'OPENAPI_IT_TOKEN');
      return new OpenapiItProvider({ environment: env, token: token! });
    }
    case 'invoicetronic': {
      const [apiKey] = required(io, 'INVOICETRONIC_API_KEY');
      return new InvoicetronicProvider({
        apiKey: apiKey!,
        environment: env === 'production' ? 'live' : 'sandbox',
      });
    }
    case 'acube': {
      const [email, password] = required(io, 'ACUBE_EMAIL', 'ACUBE_PASSWORD');
      return new AcubeProvider({ environment: env, credentials: { email: email!, password: password! } });
    }
    case 'fattura-elettronica-api': {
      const [clientId, clientSecret] = required(io, 'FEA_CLIENT_ID', 'FEA_CLIENT_SECRET');
      return new FatturaElettronicaApiProvider({
        environment: env === 'production' ? 'production' : 'test',
        credentials: { clientId: clientId!, clientSecret: clientSecret! },
      });
    }
    case 'aruba': {
      const [username, password] = required(io, 'ARUBA_USERNAME', 'ARUBA_PASSWORD');
      return new ArubaProvider({
        environment: env === 'production' ? 'production' : 'demo',
        credentials: { username: username!, password: password! },
      });
    }
    case 'keliweb': {
      if (!options.confirmProduction)
        throw new FatturaPAError(
          'Keliweb has no test environment: pass --confirm-production to act on real data',
        );
      const [clientId, clientSecret, username, password] = required(
        io,
        'KELIWEB_CLIENT_ID',
        'KELIWEB_CLIENT_SECRET',
        'KELIWEB_USERNAME',
        'KELIWEB_PASSWORD',
      );
      return new KeliwebProvider({
        credentials: {
          clientId: clientId!,
          clientSecret: clientSecret!,
          username: username!,
          password: password!,
        },
      });
    }
    case 'fattureincloud':
      break;
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
  if (!(XML_PROVIDERS as readonly string[]).includes(options.provider)) {
    throw new FatturaPAError('Fatture in Cloud builds its own XML: an XML file cannot be sent through it');
  }
  if (options.legalStorage && options.provider !== 'openapi-it') {
    throw new FatturaPAError('--legal-storage is supported with openapi-it only');
  }
  if (options.signature && options.provider !== 'openapi-it' && options.provider !== 'invoicetronic') {
    throw new FatturaPAError(
      '--signature is supported with openapi-it and invoicetronic (configure signing at the provider)',
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
  const provider = createProvider(io, options);
  try {
    let result;
    if (provider instanceof OpenapiItProvider) {
      result = await provider.send(
        { xml },
        {
          ...(options.signature ? { signature: true } : {}),
          ...(options.legalStorage ? { legalStorage: true } : {}),
        },
      );
    } else if (provider instanceof InvoicetronicProvider) {
      result = await provider.send(
        { xml },
        {
          signature: options.signature ? 'Apply' : 'None',
          idempotencyKey: `fatturapa-cli-${idempotencyKey(xml)}`,
        },
      );
    } else {
      result = await provider.send({ xml });
    }
    io.stdout(`${JSON.stringify(result)}\n`);
    return ExitCode.ok;
  } finally {
    await provider.close();
  }
}

/** Same file, same key: a retried CLI send cannot create a second invoice at Invoicetronic. */
function idempotencyKey(xml: Uint8Array): string {
  return createHash('sha256').update(xml).digest('hex').slice(0, 64);
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
