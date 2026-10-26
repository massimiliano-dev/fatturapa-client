import {
  checkBusinessRules,
  parseFatturaXml,
  TIPO_DOCUMENTO,
  type IdFiscale,
} from '@massimiliano-dev/fatturapa-core';
import { readInvoiceFile } from '../input.js';
import { ExitCode, type CliIo } from '../io.js';

function maskId(id: IdFiscale | undefined): string {
  if (!id) return '-';
  return `${id.IdPaese}${'*'.repeat(Math.max(0, id.IdCodice.length - 3))}${id.IdCodice.slice(-3)}`;
}

/**
 * Prints a summary that avoids personal data: identifiers are masked and natural persons' names are not
 * printed (company names are).
 */
export async function inspectCommand(
  io: CliIo,
  file: string,
  options: { json?: boolean; today?: string },
): Promise<number> {
  const { xml, wasP7m } = await readInvoiceFile(file);
  const invoice = parseFatturaXml(xml);
  const h = invoice.FatturaElettronicaHeader;
  const party = (a: { Denominazione?: string }) => a.Denominazione ?? '[natural person]';
  const summary = {
    file,
    signedEnvelope: wasP7m,
    formato: invoice.versione,
    codiceDestinatario: h.DatiTrasmissione.CodiceDestinatario,
    seller: {
      name: party(h.CedentePrestatore.DatiAnagrafici.Anagrafica),
      id: maskId(h.CedentePrestatore.DatiAnagrafici.IdFiscaleIVA),
    },
    buyer: {
      name: party(h.CessionarioCommittente.DatiAnagrafici.Anagrafica),
      id: maskId(h.CessionarioCommittente.DatiAnagrafici.IdFiscaleIVA),
    },
    documents: invoice.FatturaElettronicaBody.map((b) => {
      const d = b.DatiGenerali.DatiGeneraliDocumento;
      return {
        tipo: `${d.TipoDocumento} ${TIPO_DOCUMENTO[d.TipoDocumento] ?? ''}`.trim(),
        numero: d.Numero,
        data: d.Data,
        divisa: d.Divisa,
        totale: d.ImportoTotaleDocumento === undefined ? undefined : String(d.ImportoTotaleDocumento),
        righe: b.DatiBeniServizi.DettaglioLinee.length,
        riepilogo: (b.DatiBeniServizi.DatiRiepilogo ?? []).map((r) => ({
          aliquota: String(r.AliquotaIVA),
          natura: r.Natura,
          imponibile: String(r.ImponibileImporto),
          imposta: String(r.Imposta),
        })),
        allegati: (b.Allegati ?? []).length,
      };
    }),
    issues: checkBusinessRules(invoice, options.today ? { today: options.today } : {}),
  };
  if (options.json) {
    io.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    io.stdout(
      `${summary.formato} to ${summary.codiceDestinatario}${wasP7m ? ' (from a .p7m envelope, signature not verified)' : ''}\n`,
    );
    io.stdout(
      `seller ${summary.seller.name} ${summary.seller.id}\nbuyer  ${summary.buyer.name} ${summary.buyer.id}\n`,
    );
    for (const d of summary.documents) {
      io.stdout(
        `- ${d.tipo} n. ${d.numero} del ${d.data}: ${d.totale ?? '?'} ${d.divisa}, ${d.righe} line(s), ${d.allegati} attachment(s)\n`,
      );
      for (const r of d.riepilogo)
        io.stdout(
          `    IVA ${r.aliquota}%${r.natura ? ` ${r.natura}` : ''}: imponibile ${r.imponibile}, imposta ${r.imposta}\n`,
        );
    }
    for (const i of summary.issues) io.stdout(`  [${i.severity}] ${i.code} ${i.path}: ${i.message}\n`);
  }
  return summary.issues.some((i) => i.severity === 'error') ? ExitCode.invalid : ExitCode.ok;
}
