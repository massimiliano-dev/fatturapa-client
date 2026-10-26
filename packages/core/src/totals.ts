import type { EsigibilitaIVA, Natura } from './codes.js';
import { Decimal, sum } from './decimal.js';
import { FatturaPAModelError } from './errors.js';
import type {
  DatiRiepilogo,
  DettaglioLinee,
  FatturaElettronica,
  FatturaElettronicaBody,
  Num,
  ScontoMaggiorazione,
} from './model.js';

/** Options of {@link computeTotals}. */
export interface ComputeTotalsOptions {
  /** Decimals of the computed PrezzoTotale (2 to 8). Default 2. The SDI tolerates ±0.01 (00423). */
  lineTotalDecimals?: number;
  /** EsigibilitaIVA written in computed summaries of taxable rates (`I`, `D` or `S` split payment). */
  esigibilitaIVA?: EsigibilitaIVA;
  /** RiferimentoNormativo written in computed summaries, per Natura (the law that justifies it). */
  riferimentiNormativi?: Partial<Record<Natura, string>>;
  /**
   * Fill ImportoTotaleDocumento when missing: Σ ImponibileImporto + Σ Imposta of the summaries, plus the
   * document-level Arrotondamento. Default true. Stamp duty charged to the customer must be a line.
   */
  importoTotaleDocumento?: boolean;
}

/**
 * Applies line discounts/surcharges in order to a unit price: percentages compound on the running
 * price, amounts are per unit. This is "(PrezzoUnitario ± ScontoMaggiorazione)" of rejection code 00423.
 */
export function applyScontoMaggiorazione(
  unitPrice: Num,
  items: readonly ScontoMaggiorazione[] = [],
): Decimal {
  let price = Decimal.from(unitPrice);
  for (const item of items) {
    const sign = item.Tipo === 'SC' ? -1 : 1;
    if (item.Percentuale !== undefined) {
      const delta = price.mul(item.Percentuale).shift(2);
      price = sign < 0 ? price.sub(delta) : price.add(delta);
    } else if (item.Importo !== undefined) {
      price = sign < 0 ? price.sub(item.Importo) : price.add(item.Importo);
    }
  }
  return price;
}

/** PrezzoTotale of a line, unrounded: (PrezzoUnitario ± ScontoMaggiorazione) × Quantita (default 1). */
export function linePrezzoTotale(
  line: Pick<DettaglioLinee, 'PrezzoUnitario' | 'ScontoMaggiorazione' | 'Quantita'>,
): Decimal {
  return applyScontoMaggiorazione(line.PrezzoUnitario, line.ScontoMaggiorazione).mul(line.Quantita ?? 1);
}

/** Imposta of a summary: AliquotaIVA × ImponibileImporto / 100, rounded half up to the cent (00421). */
export function computeImposta(aliquotaIVA: Num, imponibile: Num): Decimal {
  return Decimal.from(imponibile).mul(aliquotaIVA).shift(2).round(2);
}

/** Grouping key of a VAT summary: rate (normalised) and nature. */
export function riepilogoKey(aliquota: Num, natura: string | undefined): string {
  return `${Decimal.from(aliquota).toFixed(2)}|${natura ?? ''}`;
}

/**
 * Returns a copy of the invoice with the derived values filled in, never overwriting values you set:
 * - `NumeroLinea` (1, 2, 3, … in order) for lines without one;
 * - `PrezzoTotale` for lines without one, rounded to `lineTotalDecimals` (default 2);
 * - `DatiRiepilogo`, when absent, with one block per distinct AliquotaIVA + Natura of the lines and of
 *   DatiCassaPrevidenziale: ImponibileImporto = Σ PrezzoTotale + Σ ImportoContributoCassa (00422),
 *   Imposta = AliquotaIVA × ImponibileImporto / 100 rounded to the cent (00421);
 * - `ImportoTotaleDocumento` when absent (see {@link ComputeTotalsOptions.importoTotaleDocumento}).
 *
 * The input is not modified.
 */
export function computeTotals(
  invoice: FatturaElettronica,
  options: ComputeTotalsOptions = {},
): FatturaElettronica {
  const decimals = options.lineTotalDecimals ?? 2;
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 8)
    throw new RangeError('lineTotalDecimals must be 2..8');
  const copy = cloneModel(invoice);
  copy.FatturaElettronicaBody = copy.FatturaElettronicaBody.map((body, i) =>
    computeBodyTotals(body, decimals, options, `FatturaElettronicaBody[${i}]`),
  );
  return copy;
}

function computeBodyTotals(
  body: FatturaElettronicaBody,
  decimals: number,
  options: ComputeTotalsOptions,
  path: string,
): FatturaElettronicaBody {
  const lines = body.DatiBeniServizi.DettaglioLinee.map((line, i) => {
    const out: DettaglioLinee = { ...line };
    out.NumeroLinea ??= i + 1;
    if (out.PrezzoTotale === undefined) {
      try {
        out.PrezzoTotale = linePrezzoTotale(out).round(decimals).toFixedRange(2, decimals);
      } catch {
        throw new FatturaPAModelError(
          `${path}.DatiBeniServizi.DettaglioLinee[${i}]`,
          'has non-numeric amounts',
        );
      }
    }
    return out;
  });

  let riepilogo = body.DatiBeniServizi.DatiRiepilogo;
  if (riepilogo === undefined || riepilogo.length === 0) {
    const groups = new Map<string, { aliquota: Decimal; natura: Natura | undefined; imponibile: Decimal }>();
    const addTo = (aliquota: Num, natura: Natura | undefined, amount: Num) => {
      const key = riepilogoKey(aliquota, natura);
      const group = groups.get(key) ?? {
        aliquota: Decimal.from(aliquota),
        natura,
        imponibile: Decimal.zero(),
      };
      group.imponibile = group.imponibile.add(amount);
      groups.set(key, group);
    };
    for (const line of lines) addTo(line.AliquotaIVA, line.Natura, line.PrezzoTotale!);
    for (const cassa of body.DatiGenerali.DatiGeneraliDocumento.DatiCassaPrevidenziale ?? []) {
      addTo(cassa.AliquotaIVA, cassa.Natura, cassa.ImportoContributoCassa);
    }
    riepilogo = [...groups.values()].map(({ aliquota, natura, imponibile }): DatiRiepilogo => {
      const block: DatiRiepilogo = {
        AliquotaIVA: aliquota.toFixed(2),
        ...(natura === undefined ? {} : { Natura: natura }),
        ImponibileImporto: imponibile.round(2).toFixed(2),
        Imposta: computeImposta(aliquota, imponibile.round(2)).toFixed(2),
      };
      if (!aliquota.isZero() && options.esigibilitaIVA) block.EsigibilitaIVA = options.esigibilitaIVA;
      const riferimento = natura === undefined ? undefined : options.riferimentiNormativi?.[natura];
      if (riferimento !== undefined) block.RiferimentoNormativo = riferimento;
      return block;
    });
  }

  const documento = { ...body.DatiGenerali.DatiGeneraliDocumento };
  if (documento.ImportoTotaleDocumento === undefined && options.importoTotaleDocumento !== false) {
    const total = sum(riepilogo.flatMap((r) => [r.ImponibileImporto, r.Imposta])).add(
      documento.Arrotondamento ?? 0,
    );
    documento.ImportoTotaleDocumento = total.toFixed(2);
  }

  return {
    ...body,
    DatiGenerali: { ...body.DatiGenerali, DatiGeneraliDocumento: documento },
    DatiBeniServizi: { DettaglioLinee: lines, DatiRiepilogo: riepilogo },
  };
}

/**
 * Deep copy of a model. `structuredClone` cannot be used: it turns {@link Decimal} instances into plain
 * objects. Decimals are immutable and shared; byte arrays are copied.
 */
export function cloneModel<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Decimal) return value;
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  if (Array.isArray(value)) return value.map((item) => cloneModel(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = cloneModel(v);
  return out as T;
}
