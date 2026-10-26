import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFatturaXml, computeTotals } from '@massimiliano-dev/fatturapa-core';
import { NS_PA, RC_PA, syntheticInvoice, syntheticP7m } from '@massimiliano-dev/fatturapa-fixtures';
import { runCli, type CliIo } from '../src/index.js';

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    env,
    cwd: resolve(import.meta.dirname, '../../..'),
  };
  return { io: value, out: () => out.join(''), err: () => err.join('') };
}

let dir: string;
let valid: string;
let invalid: string;
let p7m: string;
const schemasAvailable = existsSync(
  resolve(import.meta.dirname, '../../../vendor/fatturapa-schemas/Schema_VFPR12_v1.2.3.xsd'),
);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fatturapa-cli-'));
  const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
  valid = join(dir, 'IT01234567897_00001.xml');
  await writeFile(valid, xml);
  invalid = join(dir, 'invalid.xml');
  await writeFile(invalid, xml.replace('<Imposta>149.60</Imposta>', '<Imposta>160.00</Imposta>'));
  p7m = join(dir, 'IT01234567897_00002.xml.p7m');
  await writeFile(p7m, syntheticP7m(new TextEncoder().encode(xml)));
  await writeFile(join(dir, 'rc.xml'), RC_PA);
  await writeFile(join(dir, 'ns.xml'), NS_PA);
});

describe('fatturapa CLI', () => {
  it('validates with rules only', async () => {
    const t = io();
    expect(await runCli(['validate', valid, '--rules-only', '--today', '2026-06-01'], t.io)).toBe(0);
    expect(t.out()).toContain('VALID');
    const bad = io();
    expect(await runCli(['validate', invalid, '--rules-only', '--today', '2026-06-01'], bad.io)).toBe(1);
    expect(bad.out()).toContain('00421');
  });

  it.skipIf(!schemasAvailable)('validates against the official XSD', async () => {
    const t = io();
    expect(await runCli(['validate', valid, '--today', '2026-06-01', '--json'], t.io)).toBe(0);
    expect(JSON.parse(t.out())).toEqual({ valid: true, issues: [] });
  });

  it('inspects plain and .p7m invoices with masked identifiers', async () => {
    const t = io();
    expect(await runCli(['inspect', p7m, '--today', '2026-06-01'], t.io)).toBe(0);
    expect(t.out()).toContain('from a .p7m envelope, signature not verified');
    expect(t.out()).toContain('IT********897');
    expect(t.out()).not.toContain('01234567897');
    expect(t.out()).toContain('TD01 Fattura n. FPR 1/26 del 2026-05-20: 841.89 EUR');
  });

  it('parses notifications and sets the exit code from the outcome', async () => {
    const rc = io();
    expect(await runCli(['notification', join(dir, 'rc.xml')], rc.io)).toBe(0);
    expect(rc.out()).toContain('invoice status delivered');
    const ns = io();
    expect(await runCli(['notification', join(dir, 'ns.xml')], ns.io)).toBe(1);
    expect(ns.out()).toContain('00423');
  });

  it('builds file names', async () => {
    const t = io();
    expect(await runCli(['filename', '--id', 'IT01234567897', '--progressive', '36'], t.io)).toBe(0);
    expect(t.out()).toBe('IT01234567897_00010.xml\n');
  });

  it('never takes tokens from flags and requires explicit production confirmation', async () => {
    const noToken = io();
    expect(await runCli(['status', 'u-1', '--provider', 'openapi-it'], noToken.io)).toBe(2);
    expect(noToken.err()).toContain('OPENAPI_IT_TOKEN');
    const prod = io({ OPENAPI_IT_TOKEN: 'x' });
    expect(await runCli(['status', 'u-1', '--provider', 'openapi-it', '--env', 'production'], prod.io)).toBe(
      2,
    );
    expect(prod.err()).toContain('--confirm-production');
    const fic = io({ FIC_ACCESS_TOKEN: 'x', FIC_COMPANY_ID: '1' });
    expect(await runCli(['status', '1', '--provider', 'fattureincloud'], fic.io)).toBe(2);
    expect(fic.err()).toContain('no sandbox');
    expect(await runCli(['send', valid, '--provider', 'openapi-it', '--token', 'x'], io().io)).toBe(2);
  });

  it('refuses to send invalid invoices and supports dry runs', async () => {
    const bad = io({ OPENAPI_IT_TOKEN: 'x' });
    expect(
      await runCli(['send', invalid, '--provider', 'openapi-it', '--schemas', join(dir, 'missing')], bad.io),
    ).toBe(2);
    const dry = io();
    expect(
      await runCli(
        ['send', valid, '--provider', 'openapi-it', '--no-validate', '--dry-run', '--signature'],
        dry.io,
      ),
    ).toBe(0);
    expect(dry.out()).toContain('DRY RUN');
  });

  it('refuses symlinks to special files, unsafe XML and prints errors redacted', async () => {
    const xxe = join(dir, 'xxe.xml');
    await writeFile(
      xxe,
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
    );
    const t = io();
    expect(await runCli(['inspect', xxe], t.io)).toBe(1);
    expect(t.err()).toContain('DOCTYPE');
    const link = join(dir, 'dev.xml');
    await symlink('/dev/zero', link).catch(() => undefined);
    if (existsSync(link)) {
      const d = io();
      expect(await runCli(['inspect', link], d.io)).toBe(2);
      expect(d.err()).toContain('not a regular file');
    }
  });
});
