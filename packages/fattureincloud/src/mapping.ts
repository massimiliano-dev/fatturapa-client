import {
  Decimal,
  FatturaPAModelError,
  riepilogoKey,
  type DettaglioLinee,
  type FatturaElettronica,
  type Natura,
} from '@massimiliano-dev/fatturapa-core';
import type { FicVatType } from './schemas.js';

/** Thrown when an invoice uses FatturaPA features this mapping cannot express in Fatture in Cloud. */
export class FicMappingError extends FatturaPAModelError {}

/** Options of {@link toFicIssuedDocument}. */
export interface FicMappingOptions {
  /**
   * `provider` (default): Fatture in Cloud assigns the next number of the numeration.
   * `invoice`: use `Numero` from the invoice, which must be `<digits><suffix>` (e.g. `12/A` → number 12,
   * numeration `/A`).
   */
  numbering?: 'provider' | 'invoice';
}

/**
 * Finds the company's VAT type for a rate and nature. Fatture in Cloud requires the id of one of the
 * company's VAT types (`GET /c/{company_id}/info/vat_types`) on every line.
 */
export function findVatType(
  vatTypes: readonly FicVatType[],
  aliquota: string,
  natura: Natura | undefined,
): FicVatType | undefined {
  const rate = Decimal.from(aliquota);
  return vatTypes.find(
    (v) =>
      v.is_disabled !== true &&
      v.value !== null &&
      v.value !== undefined &&
      Decimal.from(v.value).eq(rate) &&
      (natura === undefined ? !v.ei_type || rate.sign() > 0 : v.ei_type === natura),
  );
}

function unsupported(path: string, what: string): never {
  throw new FicMappingError(
    path,
    `${what} cannot be sent through the Fatture in Cloud mapping of this release`,
  );
}

function lineDiscount(line: DettaglioLinee, path: string): number | undefined {
  const items = line.ScontoMaggiorazione ?? [];
  if (items.length === 0) return undefined;
  const [first] = items;
  if (
    items.length > 1 ||
    first?.Tipo !== 'SC' ||
    first.Percentuale === undefined ||
    first.Importo !== undefined
  ) {
    unsupported(`${path}.ScontoMaggiorazione`, 'Only one percentage discount per line');
  }
  return Number(Decimal.from(first.Percentuale!).toFixed(2));
}

/**
 * Maps the typed invoice to a Fatture in Cloud `IssuedDocument` (`POST /c/{company_id}/issued_documents`).
 * Fatture in Cloud generates the FatturaPA XML itself, so only the fields with a counterpart are mapped
 * and anything else is refused rather than silently dropped:
 * - one body, TipoDocumento TD01 (invoice) or TD04 (credit note);
 * - buyer, lines with at most one percentage discount, VAT via the company's VAT types, payments;
 * - one order, contract or agreement reference (with CIG/CUP);
 * - not supported (error): withholding tax, pension funds, stamp duty, document discounts, attachments,
 *   linked invoices, DDT/transport/SAL data, self-invoices and other TD types.
 *
 * The seller is the company of the access token: the CedentePrestatore of the model is ignored except
 * for consistency checks done by Fatture in Cloud.
 */
export function toFicIssuedDocument(
  invoice: FatturaElettronica,
  vatTypes: readonly FicVatType[],
  options: FicMappingOptions = {},
): Record<string, unknown> {
  if (invoice.FatturaElettronicaBody.length !== 1)
    unsupported('FatturaElettronicaBody', 'A batch of invoices');
  const body = invoice.FatturaElettronicaBody[0]!;
  const p = 'FatturaElettronicaBody[0]';
  const doc = body.DatiGenerali.DatiGeneraliDocumento;
  const type =
    doc.TipoDocumento === 'TD01'
      ? 'invoice'
      : doc.TipoDocumento === 'TD04'
        ? 'credit_note'
        : unsupported(`${p}.DatiGenerali.DatiGeneraliDocumento.TipoDocumento`, doc.TipoDocumento);
  if (doc.DatiRitenuta?.length)
    unsupported(`${p}.DatiGenerali.DatiGeneraliDocumento.DatiRitenuta`, 'Withholding tax');
  if (doc.DatiCassaPrevidenziale?.length)
    unsupported(
      `${p}.DatiGenerali.DatiGeneraliDocumento.DatiCassaPrevidenziale`,
      'Pension fund contributions',
    );
  if (doc.DatiBollo) unsupported(`${p}.DatiGenerali.DatiGeneraliDocumento.DatiBollo`, 'Stamp duty');
  if (doc.ScontoMaggiorazione?.length)
    unsupported(`${p}.DatiGenerali.DatiGeneraliDocumento.ScontoMaggiorazione`, 'Document-level discounts');
  if (body.Allegati?.length) unsupported(`${p}.Allegati`, 'Attachments');
  const g = body.DatiGenerali;
  if (
    g.DatiRicezione?.length ||
    g.DatiFattureCollegate?.length ||
    g.DatiDDT?.length ||
    g.DatiSAL?.length ||
    g.DatiTrasporto
  ) {
    unsupported(`${p}.DatiGenerali`, 'Receipt, linked invoice, transport and progress references');
  }
  // Fatture in Cloud holds one "original document" (ordine, contratto or convenzione) with CIG/CUP.
  const related = [
    ...(g.DatiOrdineAcquisto ?? []).map((d) => ['ordine', d] as const),
    ...(g.DatiContratto ?? []).map((d) => ['contratto', d] as const),
    ...(g.DatiConvenzione ?? []).map((d) => ['convenzione', d] as const),
  ];
  if (related.length > 1)
    unsupported(`${p}.DatiGenerali`, 'More than one order/contract/agreement reference');

  const buyer = invoice.FatturaElettronicaHeader.CessionarioCommittente;
  const anag = buyer.DatiAnagrafici.Anagrafica;
  const t = invoice.FatturaElettronicaHeader.DatiTrasmissione;
  const entity: Record<string, unknown> = {
    type: invoice.versione === 'FPA12' ? 'pa' : anag.Denominazione !== undefined ? 'company' : 'person',
    name: anag.Denominazione ?? `${anag.Nome} ${anag.Cognome}`,
    ...(anag.Denominazione === undefined ? { first_name: anag.Nome, last_name: anag.Cognome } : {}),
    vat_number: buyer.DatiAnagrafici.IdFiscaleIVA?.IdCodice ?? '',
    tax_code: buyer.DatiAnagrafici.CodiceFiscale ?? '',
    address_street: [buyer.Sede.Indirizzo, buyer.Sede.NumeroCivico].filter(Boolean).join(', '),
    address_postal_code: buyer.Sede.CAP,
    address_city: buyer.Sede.Comune,
    address_province: buyer.Sede.Provincia ?? '',
    country_iso: buyer.Sede.Nazione,
    ei_code: t.CodiceDestinatario,
    ...(t.PECDestinatario ? { certified_email: t.PECDestinatario } : {}),
  };

  const riepilogo = new Map(
    (body.DatiBeniServizi.DatiRiepilogo ?? []).map((r) => [riepilogoKey(r.AliquotaIVA, r.Natura), r]),
  );
  const esigibilita = new Set(
    (body.DatiBeniServizi.DatiRiepilogo ?? []).map((r) => r.EsigibilitaIVA).filter(Boolean),
  );
  if (esigibilita.size > 1) unsupported(`${p}.DatiBeniServizi.DatiRiepilogo`, 'Mixed EsigibilitaIVA values');

  const items = body.DatiBeniServizi.DettaglioLinee.map((line, i) => {
    const lp = `${p}.DatiBeniServizi.DettaglioLinee[${i}]`;
    if (line.Ritenuta) unsupported(`${lp}.Ritenuta`, 'Withholding tax');
    const aliquota = Decimal.from(line.AliquotaIVA).toFixed(2);
    const vat = findVatType(vatTypes, aliquota, line.Natura);
    if (!vat)
      throw new FicMappingError(
        `${lp}.AliquotaIVA`,
        `no enabled VAT type of the company matches rate ${aliquota}${line.Natura ? ` and nature ${line.Natura}` : ''}`,
      );
    if (!riepilogo.has(riepilogoKey(aliquota, line.Natura)) && riepilogo.size > 0) {
      throw new FicMappingError(`${lp}.AliquotaIVA`, 'has no matching DatiRiepilogo');
    }
    const discount = lineDiscount(line, lp);
    return {
      ...(line.CodiceArticolo?.[0] ? { code: line.CodiceArticolo[0].CodiceValore } : {}),
      name: line.Descrizione.slice(0, 255),
      ...(line.Descrizione.length > 255 ? { description: line.Descrizione } : {}),
      qty: Number(Decimal.from(line.Quantita ?? 1).toFixedRange(0, 8)),
      ...(line.UnitaMisura ? { measure: line.UnitaMisura } : {}),
      net_price: Number(Decimal.from(line.PrezzoUnitario).toFixedRange(2, 8)),
      ...(discount === undefined ? {} : { discount }),
      vat: { id: vat.id },
    };
  });

  const payments = (body.DatiPagamento ?? []).flatMap((pg) => pg.DettaglioPagamento);
  const methods = new Set(payments.map((d) => d.ModalitaPagamento));
  if (methods.size > 1) unsupported(`${p}.DatiPagamento`, 'Different payment methods in one invoice');
  const iban = payments.find((d) => d.IBAN)?.IBAN;
  const [relatedType, order] = related[0] ?? [];

  const numbering: Record<string, unknown> = {};
  if ((options.numbering ?? 'provider') === 'invoice') {
    const match = /^(\d+)(\D.*)?$/.exec(doc.Numero);
    if (!match)
      throw new FicMappingError(
        `${p}.DatiGenerali.DatiGeneraliDocumento.Numero`,
        'must be <digits><suffix> with numbering "invoice"',
      );
    numbering.number = Number(match[1]);
    if (match[2]) numbering.numeration = match[2];
  }

  return {
    type,
    entity,
    date: doc.Data,
    ...numbering,
    currency: { id: doc.Divisa },
    ...(doc.Causale?.length ? { notes: doc.Causale.join('\n') } : {}),
    e_invoice: true,
    ei_data: {
      ...(esigibilita.size === 1 ? { vat_kind: [...esigibilita][0] } : {}),
      ...(payments[0] ? { payment_method: payments[0].ModalitaPagamento } : {}),
      ...(iban ? { bank_iban: iban } : {}),
      ...(order
        ? {
            original_document_type: relatedType,
            od_number: order.IdDocumento,
            ...(order.Data ? { od_date: order.Data } : {}),
            ...(order.CodiceCIG ? { cig: order.CodiceCIG } : {}),
            ...(order.CodiceCUP ? { cup: order.CodiceCUP } : {}),
          }
        : {}),
    },
    use_gross_prices: false,
    items_list: items,
    payments_list: payments.map((d) => ({
      amount: Number(Decimal.from(d.ImportoPagamento).toFixed(2)),
      due_date: d.DataScadenzaPagamento ?? doc.Data,
      status: 'not_paid',
    })),
  };
}
