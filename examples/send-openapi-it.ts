/**
 * Builds, checks and sends an invoice through the Openapi.it SANDBOX, then polls its status.
 *
 *   pnpm sync:schemas
 *   OPENAPI_IT_TOKEN=… node examples/send-openapi-it.ts
 */
import { buildFatturaXml, computeTotals, isFinalStatus } from '@massimiliano-dev/fatturapa-core';
import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import { OpenapiItProvider } from '@massimiliano-dev/fatturapa-openapi-it';
import { createFatturaPAValidator } from '@massimiliano-dev/fatturapa-validator';

const token = process.env.OPENAPI_IT_TOKEN;
if (!token) throw new Error('Set OPENAPI_IT_TOKEN');

const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
const validator = await createFatturaPAValidator('vendor/fatturapa-schemas');
const check = await validator.validate(xml);
if (!check.valid)
  throw new Error(`Invalid invoice: ${check.issues.map((i) => i.code ?? i.message).join(', ')}`);

const sdi = new OpenapiItProvider({ environment: 'sandbox', token });
try {
  const { id } = await sdi.send({ xml });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const status = await sdi.getStatus(id);
    process.stdout.write(`${status.status}\n`);
    if (isFinalStatus(status.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
} finally {
  await sdi.close();
}
