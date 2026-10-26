import { describe, expect, it } from 'vitest';
import { buildFatturaXml, checkBusinessRules, computeTotals, type FatturaElettronica } from '../src/index.js';

// Keeps the README example honest.
describe('README example', () => {
  it('builds a valid invoice from the minimal draft', () => {
    const draft: FatturaElettronica = {
      versione: 'FPR12',
      FatturaElettronicaHeader: {
        DatiTrasmissione: {
          IdTrasmittente: { IdPaese: 'IT', IdCodice: '01234567897' },
          ProgressivoInvio: '00001',
          CodiceDestinatario: '0000000',
        },
        CedentePrestatore: {
          DatiAnagrafici: {
            IdFiscaleIVA: { IdPaese: 'IT', IdCodice: '01234567897' },
            Anagrafica: { Denominazione: 'Fornitore S.r.l.' },
            RegimeFiscale: 'RF01',
          },
          Sede: { Indirizzo: 'Via Roma 1', CAP: '00100', Comune: 'Roma', Provincia: 'RM', Nazione: 'IT' },
        },
        CessionarioCommittente: {
          DatiAnagrafici: {
            IdFiscaleIVA: { IdPaese: 'IT', IdCodice: '09876543217' },
            Anagrafica: { Denominazione: 'Cliente S.p.A.' },
          },
          Sede: {
            Indirizzo: 'Piazza Duomo 1',
            CAP: '20100',
            Comune: 'Milano',
            Provincia: 'MI',
            Nazione: 'IT',
          },
        },
      },
      FatturaElettronicaBody: [
        {
          DatiGenerali: {
            DatiGeneraliDocumento: {
              TipoDocumento: 'TD01',
              Divisa: 'EUR',
              Data: '2026-05-20',
              Numero: '1/2026',
            },
          },
          DatiBeniServizi: {
            DettaglioLinee: [
              { Descrizione: 'Consulenza', Quantita: '10', PrezzoUnitario: '50', AliquotaIVA: '22' },
            ],
          },
        },
      ],
    };
    const invoice = computeTotals(draft);
    expect(checkBusinessRules(invoice, { today: '2026-06-01' })).toEqual([]);
    const xml = buildFatturaXml(invoice);
    expect(xml).toContain('<ImponibileImporto>500.00</ImponibileImporto>');
    expect(xml).toContain('<Imposta>110.00</Imposta>');
    expect(xml).toContain('<ImportoTotaleDocumento>610.00</ImportoTotaleDocumento>');
  });
});
