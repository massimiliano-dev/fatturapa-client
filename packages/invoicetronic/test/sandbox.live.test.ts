import { describe, expect, it } from 'vitest';
import { computeTotals } from '@massimiliano-dev/fatturapa-core';
import { syntheticInvoice } from '@massimiliano-dev/fatturapa-fixtures';
import { InvoicetronicProvider } from '../src/index.js';

// SANDBOX ONLY (ik_test_ key: nothing reaches the SDI, no credits used).
const apiKey = process.env.INVOICETRONIC_SANDBOX_API_KEY;
const enabled = process.env.FATTURAPA_LIVE === 'sandbox' && Boolean(apiKey?.startsWith('ik_test_'));

describe.skipIf(!enabled)('Invoicetronic sandbox', () => {
  it('sends the synthetic invoice idempotently and reads it back', async () => {
    const provider = new InvoicetronicProvider({ apiKey: apiKey! });
    try {
      const invoice = syntheticInvoice();
      // SBXRC00 makes the simulator deliver the invoice (docs: Sandbox).
      invoice.FatturaElettronicaHeader.DatiTrasmissione.CodiceDestinatario = 'SBXRC00';
      invoice.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Numero = `T${Date.now()}`.slice(
        0,
        20,
      );
      invoice.FatturaElettronicaBody[0]!.DatiGenerali.DatiGeneraliDocumento.Data = new Date()
        .toISOString()
        .slice(0, 10);
      const key = `live-test-${Date.now()}`;
      const first = await provider.send(
        { invoice: computeTotals(invoice) },
        { idempotencyKey: key, signature: 'None' },
      );
      const replay = await provider.send(
        { invoice: computeTotals(invoice) },
        { idempotencyKey: key, signature: 'None' },
      );
      expect(replay.id).toBe(first.id);
      expect((await provider.getStatus(first.id)).id).toBe(first.id);
    } finally {
      await provider.close();
    }
  });
});
