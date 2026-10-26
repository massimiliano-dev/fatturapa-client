import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFatturaXml, computeTotals, XSD_CODE_TABLES } from '@massimiliano-dev/fatturapa-core';
import { MT_PA, syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import {
  createFatturaPAValidator,
  createNotificationValidator,
  loadFatturaPASchema,
  PINNED_SCHEMAS,
  SchemaIntegrityError,
} from '../src/index.js';

const dir = resolve(import.meta.dirname, '../../../vendor/fatturapa-schemas');
const available = PINNED_SCHEMAS.every((p) => existsSync(join(dir, p.fileName)));

// Needs `pnpm sync:schemas` (CI job "official-xsd"); skipped otherwise.
describe.skipIf(!available)('official schemas', () => {
  it('the synthetic invoice is valid against Schema_VFPR12 1.2.3 and passes the SDI content rules', async () => {
    const validator = await createFatturaPAValidator(dir);
    const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
    expect(await validator.validate(xml, { today: '2026-06-01' })).toEqual({ valid: true, issues: [] });
  });

  it('a batch with a signature-less FPA12 header is valid too', async () => {
    const validator = await createFatturaPAValidator(dir);
    const inv = syntheticInvoice();
    inv.versione = 'FPA12';
    inv.FatturaElettronicaHeader.DatiTrasmissione.CodiceDestinatario = 'UFAAAA';
    inv.FatturaElettronicaBody.push(syntheticInvoice().FatturaElettronicaBody[0]!);
    inv.FatturaElettronicaBody[1]!.DatiGenerali.DatiGeneraliDocumento.Numero = 'FPA 2/26';
    const result = await validator.validate(buildFatturaXml(computeTotals(inv)), { today: '2026-06-01' });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('reports XSD errors and then SDI rule errors', async () => {
    const validator = await createFatturaPAValidator(dir);
    const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
    const xsd = await validator.validate(xml.replace('<Divisa>EUR</Divisa>', ''));
    expect(xsd.valid).toBe(false);
    expect(xsd.issues[0]?.source).toBe('xsd');
    const rules = await validator.validate(
      xml.replace('<Imposta>149.60</Imposta>', '<Imposta>150.60</Imposta>'),
      { today: '2026-06-01' },
    );
    expect(rules.issues.map((i) => i.code)).toContain('00421');
  });

  it('SDI metadata notifications validate against MessaggiTypes 1.1', async () => {
    const validator = await createNotificationValidator(dir, 'messaggi-pa');
    expect((await validator.validate(MT_PA)).valid).toBe(true);
  });

  it('the generated code tables match the XSD enumerations', async () => {
    const xsd = await readFile(join(dir, 'Schema_VFPR12_v1.2.3.xsd'), 'utf8');
    for (const [typeName, table] of Object.entries(XSD_CODE_TABLES)) {
      const block =
        new RegExp(`<xs:simpleType name="${typeName}">([\\s\\S]*?)</xs:simpleType>`).exec(xsd)?.[1] ?? '';
      const values = [...block.matchAll(/<xs:enumeration value="([^"]+)"/g)].map((m) => m[1]);
      expect(Object.keys(table), typeName).toEqual(values);
    }
  });

  it('detects a tampered schema file', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'fatturapa-schemas-'));
    for (const p of PINNED_SCHEMAS) await copyFile(join(dir, p.fileName), join(copy, p.fileName));
    const xsd = join(copy, 'Schema_VFPR12_v1.2.3.xsd');
    await writeFile(
      xsd,
      (await readFile(xsd, 'utf8')).replace('maxLength value="28"', 'maxLength value="280"'),
    );
    await expect(loadFatturaPASchema(copy)).rejects.toThrow(SchemaIntegrityError);
  });
});
