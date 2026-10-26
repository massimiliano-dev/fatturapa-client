import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import { describe, expect, it } from 'vitest';
import {
  buildFatturaXml,
  checkBusinessRules,
  computeTotals,
  Decimal,
  FatturaPAModelError,
  parseFatturaXml,
  type FatturaElettronica,
} from '../src/index.js';

function complete(): FatturaElettronica {
  return computeTotals(syntheticInvoice());
}

describe('computeTotals', () => {
  it('fills line numbers, line totals, VAT summaries and the document total', () => {
    const inv = complete();
    const body = inv.FatturaElettronicaBody[0]!;
    expect(body.DatiBeniServizi.DettaglioLinee.map((l) => [l.NumeroLinea, l.PrezzoTotale])).toEqual([
      [1, '500.00'],
      [2, '179.99'],
      [3, '12.30'],
    ]);
    expect(body.DatiBeniServizi.DatiRiepilogo).toEqual([
      { AliquotaIVA: '22.00', ImponibileImporto: '679.99', Imposta: '149.60' },
      { AliquotaIVA: '0.00', Natura: 'N2.2', ImponibileImporto: '12.30', Imposta: '0.00' },
    ]);
    expect(body.DatiGenerali.DatiGeneraliDocumento.ImportoTotaleDocumento).toBe('841.89');
  });

  it('does not modify its input and keeps Decimal instances', () => {
    const input = syntheticInvoice();
    input.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.PrezzoUnitario = Decimal.from('50');
    const before = JSON.stringify(input);
    const out = computeTotals(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(out.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.PrezzoUnitario).toBeInstanceOf(
      Decimal,
    );
  });

  it('includes pension fund contributions in the summary', () => {
    const inv = syntheticInvoice();
    inv.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.DatiCassaPrevidenziale = [
      { TipoCassa: 'TC22', AlCassa: '4.00', ImportoContributoCassa: '20.00', AliquotaIVA: '22.00' },
    ];
    const r = computeTotals(inv).FatturaElettronicaBody[0]!.DatiBeniServizi.DatiRiepilogo![0]!;
    expect(r).toMatchObject({ ImponibileImporto: '699.99', Imposta: '154.00' });
  });
});

describe('buildFatturaXml', () => {
  it('produces XML with a qualified root and unqualified children, in schema order', () => {
    const xml = buildFatturaXml(complete());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica')).toBe(true);
    expect(xml).toContain('xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"');
    expect(xml).toContain('versione="FPR12"');
    expect(xml).toContain('<FormatoTrasmissione>FPR12</FormatoTrasmissione>');
    expect(xml.indexOf('<PrezzoUnitario>')).toBeLessThan(xml.indexOf('<ScontoMaggiorazione>'));
    expect(xml.indexOf('<ScontoMaggiorazione>')).toBeLessThan(xml.indexOf('<PrezzoTotale>179.99'));
    expect(xml).toContain('<Quantita>10.00</Quantita>');
  });

  it('round-trips through the parser', () => {
    const inv = complete();
    const parsed = parseFatturaXml(buildFatturaXml(inv));
    expect(buildFatturaXml(parsed)).toBe(buildFatturaXml(inv));
    expect(parsed.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.NumeroLinea).toBe(1);
  });

  it('escapes markup in text', () => {
    const inv = complete();
    inv.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Causale = [
      'A & B <script>"x"</script>',
    ];
    const xml = buildFatturaXml(inv);
    expect(xml).toContain('<Causale>A &amp; B &lt;script&gt;&quot;x&quot;&lt;/script&gt;</Causale>');
    expect(
      parseFatturaXml(xml).FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Causale,
    ).toEqual(['A & B <script>"x"</script>']);
  });

  it('refuses characters outside the XSD character set, unless transliteration is requested', () => {
    const inv = complete();
    inv.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.Descrizione =
      'Consulenza “premium” – 10 €';
    expect(() => buildFatturaXml(inv)).toThrow(FatturaPAModelError);
    expect(() => buildFatturaXml(inv)).toThrow(/DettaglioLinee\[0\]\.Descrizione.*U\+201C/);
    expect(buildFatturaXml(inv, { text: 'transliterate' })).toContain(
      'Consulenza &quot;premium&quot; - 10 EUR',
    );
  });

  it('refuses values that break XSD facets, naming the element', () => {
    const cases: [(i: FatturaElettronica) => void, RegExp][] = [
      [
        (i) => (i.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.AliquotaIVA = '22.005'),
        /AliquotaIVA: has more than 2 decimal/,
      ],
      [
        (i) => (i.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Data = '2026-02-30'),
        /Data: is not a valid calendar date/,
      ],
      [
        (i) => (i.FatturaElettronicaHeader.DatiTrasmissione.CodiceDestinatario = 'abc'),
        /CodiceDestinatario: must be/,
      ],
      [
        (i) => (i.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Numero = 'X'.repeat(21)),
        /Numero: length/,
      ],
      [
        (i) =>
          ((
            i.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento as { TipoDocumento: string }
          ).TipoDocumento = 'TD99'),
        /TipoDocumento: is not a valid code/,
      ],
      [(i) => (i.FatturaElettronicaHeader.DatiTrasmissione.FormatoTrasmissione = 'FPA12'), /00428/],
      [
        (i) => (i.FatturaElettronicaBody[0]!.DatiBeniServizi.DettaglioLinee[0]!.Descrizione = 'a\u0001b'),
        /control characters/,
      ],
    ];
    for (const [mutate, message] of cases) {
      const inv = complete();
      mutate(inv);
      expect(() => buildFatturaXml(inv)).toThrow(message);
    }
  });

  it('requires computed fields', () => {
    expect(() => buildFatturaXml(syntheticInvoice())).toThrow(/computeTotals/);
  });

  it('encodes attachments as base64 and decodes them back', () => {
    const inv = complete();
    inv.FatturaElettronicaBody[0]!.Allegati = [
      { NomeAttachment: 'nota.txt', FormatoAttachment: 'TXT', Attachment: new TextEncoder().encode('ciao') },
    ];
    const parsed = parseFatturaXml(buildFatturaXml(inv));
    expect(new TextDecoder().decode(parsed.FatturaElettronicaBody[0]!.Allegati![0]!.Attachment)).toBe('ciao');
  });
});

describe('checkBusinessRules', () => {
  it('accepts the synthetic invoice', () => {
    expect(checkBusinessRules(complete(), { today: '2026-06-01' })).toEqual([]);
  });

  it('reports the SDI codes the invoice would be rejected with', () => {
    const inv = complete();
    const body = inv.FatturaElettronicaBody[0]!;
    body.DatiBeniServizi.DettaglioLinee[0]!.PrezzoTotale = '499.00'; // 00423
    body.DatiBeniServizi.DettaglioLinee[2]!.Natura = undefined; // 00400, 00429 still has it
    body.DatiBeniServizi.DatiRiepilogo![0]!.Imposta = '150.00'; // 00421
    body.DatiGenerali.DatiGeneraliDocumento.Numero = 'ABC'; // 00425
    inv.FatturaElettronicaHeader.DatiTrasmissione.CodiceDestinatario = 'ABC123'; // 00427 (6 chars with FPR12)
    const codes = checkBusinessRules(inv, { today: '2026-06-01' }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['00423', '00400', '00421', '00425', '00427']));
  });

  it('flags generic natures, fractions as rates, future dates and same-party invoices', () => {
    const inv = complete();
    const body = inv.FatturaElettronicaBody[0]!;
    body.DatiBeniServizi.DettaglioLinee[2]!.Natura = 'N2';
    body.DatiBeniServizi.DatiRiepilogo![1]!.Natura = 'N2';
    body.DatiBeniServizi.DettaglioLinee[0]!.AliquotaIVA = '0.22';
    body.DatiGenerali.DatiGeneraliDocumento.Data = '2026-12-31';
    inv.FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.IdFiscaleIVA = {
      IdPaese: 'IT',
      IdCodice: '01234567897',
    };
    const codes = checkBusinessRules(inv, { today: '2026-06-01' }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['00445', '00424', '00403', '00471', '00419']));
  });

  it('warns about wrong check digits', () => {
    const inv = complete();
    inv.FatturaElettronicaHeader.CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdCodice = '01234567890';
    const issue = checkBusinessRules(inv, { today: '2026-06-01' }).find((i) => i.code === '00301');
    expect(issue?.severity).toBe('warning');
  });
});
