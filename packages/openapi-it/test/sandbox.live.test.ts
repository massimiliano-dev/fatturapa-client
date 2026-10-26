import { describe, expect, it } from 'vitest';
import { computeTotals, isFinalStatus } from '@massimiliano-dev/fatturapa-core';
import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import { OpenapiItProvider } from '../src/index.js';

// SANDBOX ONLY, synthetic data only. Runs when FATTURAPA_LIVE=sandbox and the token is set (CONTRIBUTING.md).
const token = process.env.OPENAPI_IT_SANDBOX_TOKEN;
const fiscalId = process.env.OPENAPI_IT_SANDBOX_FISCAL_ID;
const enabled = process.env.FATTURAPA_LIVE === 'sandbox' && Boolean(token) && Boolean(fiscalId);

describe.skipIf(!enabled)('Openapi.it sandbox', () => {
  it('sends the synthetic invoice and reads its status', async () => {
    const provider = new OpenapiItProvider({ environment: 'sandbox', token: token! });
    try {
      const invoice = syntheticInvoice();
      // The sandbox accepts invoices only for the configured business registry.
      invoice.FatturaElettronicaHeader.CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdCodice = fiscalId!;
      invoice.FatturaElettronicaHeader.DatiTrasmissione.IdTrasmittente.IdCodice = fiscalId!;
      invoice.FatturaElettronicaHeader.DatiTrasmissione.ProgressivoInvio = Date.now().toString(36).slice(-10);
      invoice.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Numero = `T${Date.now()}`.slice(
        0,
        20,
      );
      invoice.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Data = new Date()
        .toISOString()
        .slice(0, 10);
      const sent = await provider.send({ invoice: computeTotals(invoice) });
      expect(sent.id).toMatch(/\S+/);
      const status = await provider.getStatus(sent.id);
      expect(status.id).toBe(sent.id);
      expect(typeof isFinalStatus(status.status)).toBe('boolean');
    } finally {
      await provider.close();
    }
  });
});
