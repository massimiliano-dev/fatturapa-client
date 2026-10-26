import {
  NE_PA_REFUSED,
  NS_B2B,
  NS_PA,
  MT_PA,
  RC_PA,
  syntheticCodiceFiscale,
  syntheticInvoice,
  syntheticP7m,
} from '@massimiliano-dev/fatturapa-fixtures';
import { describe, expect, it } from 'vitest';
import {
  buildFatturaXml,
  buildSdiFileName,
  computeTotals,
  describeSdiError,
  extractP7mContent,
  isValidCodiceFiscale,
  isValidPartitaIva,
  looksLikeP7m,
  P7mError,
  parseFatturaXml,
  parseSdiFileName,
  parseSdiNotification,
  parseSdiNotificationFileName,
  statusFromNotification,
  toProgressivo,
} from '../src/index.js';

describe('identifiers', () => {
  it('checks partita IVA check digits', () => {
    expect(isValidPartitaIva('01234567897')).toBe(true);
    expect(isValidPartitaIva('01234567890')).toBe(false);
    expect(isValidPartitaIva('0123456789')).toBe(false);
  });

  it('checks codice fiscale check characters, including omocodia', () => {
    const cf = syntheticCodiceFiscale();
    expect(isValidCodiceFiscale(cf)).toBe(true);
    expect(isValidCodiceFiscale(cf.slice(0, 15) + (cf[15] === 'A' ? 'B' : 'A'))).toBe(false);
    expect(isValidCodiceFiscale('01234567897')).toBe(true);
    expect(isValidCodiceFiscale(cf.toLowerCase())).toBe(false);
  });
});

describe('file names', () => {
  it('builds and parses SDI invoice file names (Allegato A §1.2.2)', () => {
    expect(buildSdiFileName({ country: 'IT', identifier: '01234567897', progressive: 1 })).toBe(
      'IT01234567897_00001.xml',
    );
    expect(toProgressivo(36 ** 5 - 1)).toBe('ZZZZZ');
    expect(parseSdiFileName('IT01234567897_0A1b2.xml.p7m')).toEqual({
      country: 'IT',
      identifier: '01234567897',
      progressive: '0A1b2',
      extension: 'xml.p7m',
    });
    expect(parseSdiFileName('IT0123_00001.xml')).toBeUndefined(); // IT identifiers are 11-16 characters
    expect(parseSdiFileName('IT01234567897_000001.xml')).toBeUndefined(); // progressive max 5
    expect(parseSdiFileName('../IT01234567897_00001.xml')).toBeUndefined();
    expect(() =>
      buildSdiFileName({ country: 'IT', identifier: '01234567897', progressive: 'x/y' }),
    ).toThrow();
  });

  it('parses notification file names', () => {
    expect(parseSdiNotificationFileName('IT01234567897_00001_NS_001.xml')).toEqual({
      invoiceFileBaseName: 'IT01234567897_00001',
      type: 'NS',
      progressive: '001',
    });
  });
});

describe('SDI notifications', () => {
  it('parses a delivery receipt', () => {
    const n = parseSdiNotification(RC_PA);
    expect(n).toMatchObject({
      type: 'RC',
      family: 'pa',
      IdentificativoSdI: '111',
      Destinatario: { Codice: 'AAAAAA' },
      signed: false,
    });
    expect(statusFromNotification(n.type)).toBe('delivered');
  });

  it('parses a rejection with official error descriptions', () => {
    const n = parseSdiNotification(NS_PA);
    expect(n.type).toBe('NS');
    expect(n.ListaErrori?.map((e) => e.Codice)).toEqual(['00400', '00423']);
    expect(n.ListaErrori?.[0]?.officialDescription).toBe(describeSdiError('00400'));
    expect(statusFromNotification('NS')).toBe('rejected');
  });

  it('parses the B2B namespace family', () => {
    const n = parseSdiNotification(NS_B2B);
    expect(n).toMatchObject({ type: 'NS', family: 'b2b', rootElement: 'RicevutaScarto' });
    expect(n.ListaErrori?.[0]).toMatchObject({ Codice: '00305', Suggerimento: 'Verificare la partita IVA' });
  });

  it('parses the PA outcome', () => {
    const n = parseSdiNotification(NE_PA_REFUSED);
    expect(n).toMatchObject({ type: 'NE', Esito: 'EC02', Descrizione: 'Importo non corretto' });
    expect(n.RiferimentoFattura).toEqual({ NumeroFattura: 'FPA 1/26', AnnoFattura: '2026' });
    expect(statusFromNotification(n.type, n.Esito)).toBe('refused');
  });

  it('parses metadata', () => {
    expect(parseSdiNotification(MT_PA)).toMatchObject({
      type: 'MT',
      CodiceDestinatario: 'AAAAAAA',
      Formato: 'FPR12',
    });
  });

  it('refuses unknown documents', () => {
    expect(() => parseSdiNotification('<Foo xmlns="urn:x"/>')).toThrow(/not a known SDI notification/);
    expect(() => parseSdiNotification(RC_PA.replace('www.fatturapa.gov.it', 'evil.example'))).toThrow(
      /namespace/,
    );
  });
});

describe('p7m', () => {
  const xml = buildFatturaXml(computeTotals(syntheticInvoice()));
  const bytes = new TextEncoder().encode(xml);

  it('extracts the invoice from DER, BER and base64 envelopes', () => {
    for (const envelope of [syntheticP7m(bytes), syntheticP7m(bytes, { ber: true, chunkSize: 100 })]) {
      expect(looksLikeP7m(envelope)).toBe(true);
      const content = extractP7mContent(envelope);
      expect(new TextDecoder().decode(content)).toBe(xml);
      expect(parseFatturaXml(content).FatturaElettronicaBody).toHaveLength(1);
    }
    const b64 = new TextEncoder().encode(Buffer.from(syntheticP7m(bytes)).toString('base64'));
    expect(new TextDecoder().decode(extractP7mContent(b64))).toBe(xml);
  });

  it('refuses truncated, oversized and non-CMS input', () => {
    const der = syntheticP7m(bytes);
    expect(() => extractP7mContent(der.subarray(0, der.length - 10))).toThrow(P7mError);
    expect(() => extractP7mContent(der, { maxBytes: 100 })).toThrow(/exceeds/);
    expect(() => extractP7mContent(new TextEncoder().encode('<xml/>'))).toThrow(P7mError);
    expect(() => extractP7mContent(new Uint8Array([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]))).toThrow(P7mError);
  });

  it('bounds nesting depth', () => {
    const deep = new Uint8Array(200);
    for (let i = 0; i < 100; i += 1) {
      deep[i * 2] = 0x30;
      deep[i * 2 + 1] = 0x80;
    }
    expect(() => extractP7mContent(deep)).toThrow(P7mError);
  });
});
