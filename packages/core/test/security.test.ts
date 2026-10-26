import {
  syntheticCodiceFiscale,
  syntheticIban,
  syntheticInvoice,
} from '@massimiliano-dev/fatturapa-fixtures';
import { describe, expect, it } from 'vitest';
import {
  assertSafeXml,
  buildFatturaXml,
  computeTotals,
  FatturaPAError,
  FatturaPAParseError,
  parseFatturaXml,
  parseSdiNotification,
  redact,
  redactValue,
  REDACTED_CF,
  REDACTED_IBAN,
  REDACTED_XML,
  UnsafeXmlError,
} from '../src/index.js';

describe('redact', () => {
  it('masks tokens, fiscal codes, IBANs, VAT numbers, e-mails and documents', () => {
    const jwt = ['eyJhbGciOiJFUzI1NiJ9', 'eyJzdWIiOiJjb21wYW55OjEifQ', 'c2lnbmF0dXJlLXNpZ25hdHVyZQ'].join(
      '.',
    );
    const text = [
      `Authorization: Bearer abc.def-123`,
      `token=${jwt}`,
      `{"access_token":"a1b2c3","client_secret":"s3cr3t"}`,
      `cf ${syntheticCodiceFiscale()} iban ${syntheticIban()} file IT01234567897_00001.xml`,
      `pec amministrazione@pec.example.it`,
    ].join('\n');
    const out = redact(text);
    expect(out).not.toContain('abc.def-123');
    expect(out).not.toContain(jwt);
    expect(out).not.toContain('a1b2c3');
    expect(out).not.toContain('s3cr3t');
    expect(out).toContain(REDACTED_CF);
    expect(out).toContain(REDACTED_IBAN);
    expect(out).toContain('[REDACTED:VAT]_00001.xml');
    expect(out).not.toContain('@pec.example.it');
  });

  it('masks a whole invoice', () => {
    const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
    expect(redact(`body: ${xml}`)).toBe(`body: ${REDACTED_XML}`);
  });

  it('deep-redacts sensitive keys', () => {
    expect(redactValue({ headers: { Authorization: 'Bearer x' }, data: { iban: 'x', note: 'ok' } })).toEqual({
      headers: { Authorization: '[REDACTED]' },
      data: { iban: '[REDACTED]', note: 'ok' },
    });
  });

  it('library errors are redacted', () => {
    const err = new FatturaPAError(`failed with token=${'x'.repeat(10)} for ${syntheticCodiceFiscale()}`);
    expect(err.message).not.toContain(syntheticCodiceFiscale());
    expect(JSON.stringify(err)).not.toContain('xxxxxxxxxx');
  });
});

describe('XML input hardening', () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">&e;</p:FatturaElettronica>`;

  it('refuses DOCTYPE and ENTITY declarations (XXE, billion laughs)', () => {
    expect(() => parseFatturaXml(xxe)).toThrow(UnsafeXmlError);
    expect(() => assertSafeXml('<a><!ENTITY x "y"></a>')).toThrow(/ENTITY/);
  });

  it('refuses non UTF-8 encodings and oversized input', () => {
    expect(() => assertSafeXml('<?xml version="1.0" encoding="UTF-16"?><a/>')).toThrow(/encoding/);
    expect(() => assertSafeXml(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toThrow(/UTF-16/);
    expect(() => assertSafeXml(new Uint8Array([0x3c, 0xc3, 0x28]))).toThrow(/not valid UTF-8/);
    expect(() => assertSafeXml('<a/>'.repeat(10), { maxBytes: 20 })).toThrow(/exceeds 20 bytes/);
  });

  it('refuses reserved element names that could pollute prototypes', () => {
    expect(() => parseSdiNotification('<__proto__><x>1</x></__proto__>')).toThrow(FatturaPAParseError);
  });

  it('refuses malformed XML without echoing content', () => {
    try {
      parseFatturaXml(`<p:FatturaElettronica>${syntheticCodiceFiscale()}`);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FatturaPAParseError);
      expect((error as Error).message).not.toContain(syntheticCodiceFiscale());
    }
  });

  it('refuses documents in another namespace', () => {
    const xml = buildFatturaXml(computeTotals(syntheticInvoice())).replace(
      'docs/xsd/fatture/v1.2',
      'evil/v1.2',
    );
    expect(() => parseFatturaXml(xml)).toThrow(/namespace/);
  });
});
