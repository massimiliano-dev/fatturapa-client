import type { FatturaElettronica } from '@massimiliano-dev/fatturapa-core';
import { BUYER_VAT, SELLER_VAT, TRANSMITTER_VAT } from './identifiers.js';

/**
 * A SYNTHETIC B2B invoice (TD01, FPR12) between two fake companies: two taxable lines at 22 % (one with a
 * 10 % discount), one line outside the VAT scope (N2.2), bank transfer payment. PrezzoTotale and
 * DatiRiepilogo are left out on purpose: tests run `computeTotals()`.
 */
export function syntheticInvoice(): FatturaElettronica {
  return {
    versione: 'FPR12',
    SistemaEmittente: 'TESTSUITE',
    FatturaElettronicaHeader: {
      DatiTrasmissione: {
        IdTrasmittente: { IdPaese: 'IT', IdCodice: TRANSMITTER_VAT },
        ProgressivoInvio: '00001',
        CodiceDestinatario: '0000000',
      },
      CedentePrestatore: {
        DatiAnagrafici: {
          IdFiscaleIVA: { IdPaese: 'IT', IdCodice: SELLER_VAT },
          Anagrafica: { Denominazione: 'Fornitore di Prova S.r.l.' },
          RegimeFiscale: 'RF01',
        },
        Sede: {
          Indirizzo: 'Via di Prova',
          NumeroCivico: '1',
          CAP: '00100',
          Comune: 'Roma',
          Provincia: 'RM',
          Nazione: 'IT',
        },
        IscrizioneREA: {
          Ufficio: 'RM',
          NumeroREA: '000000',
          CapitaleSociale: '10000.00',
          SocioUnico: 'SM',
          StatoLiquidazione: 'LN',
        },
      },
      CessionarioCommittente: {
        DatiAnagrafici: {
          IdFiscaleIVA: { IdPaese: 'IT', IdCodice: BUYER_VAT },
          Anagrafica: { Denominazione: 'Cliente di Prova S.p.A.' },
        },
        Sede: {
          Indirizzo: 'Piazza Esempio',
          NumeroCivico: '2',
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
            Numero: 'FPR 1/26',
            Causale: ['Fattura di prova generata dalla test suite'],
          },
        },
        DatiBeniServizi: {
          DettaglioLinee: [
            {
              Descrizione: 'Consulenza informatica',
              Quantita: '10.00',
              UnitaMisura: 'ore',
              PrezzoUnitario: '50.00',
              AliquotaIVA: '22.00',
            },
            {
              Descrizione: 'Licenza software annuale',
              Quantita: '1.00',
              PrezzoUnitario: '199.99',
              ScontoMaggiorazione: [{ Tipo: 'SC', Percentuale: '10.00' }],
              AliquotaIVA: '22.00',
            },
            {
              Descrizione: 'Rimborso spese anticipate',
              PrezzoUnitario: '12.30',
              AliquotaIVA: '0.00',
              Natura: 'N2.2',
            },
          ],
        },
        DatiPagamento: [
          {
            CondizioniPagamento: 'TP02',
            DettaglioPagamento: [
              { ModalitaPagamento: 'MP05', DataScadenzaPagamento: '2026-06-19', ImportoPagamento: '841.89' },
            ],
          },
        ],
      },
    ],
  };
}
