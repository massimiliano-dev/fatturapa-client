import { NATURA } from './codes.js';
import { Decimal, sum } from './decimal.js';
import { isValidCodiceFiscale, isValidPartitaIva } from './identifiers.js';
import type { FatturaElettronica, FatturaElettronicaBody, IdFiscale, Num } from './model.js';
import { describeSdiError } from './sdi-errors.js';
import { applyScontoMaggiorazione, computeImposta } from './totals.js';

/** A failed business rule. `code` is the SDI rejection code the invoice would get, when there is one. */
export interface RuleIssue {
  /** SDI rejection code (Allegato A 1.9.1, Appendice 1), or `LOCAL` for checks without an SDI code. */
  code: string;
  severity: 'error' | 'warning';
  /** Path of the element, e.g. `FatturaElettronicaBody[0].DatiBeniServizi.DatiRiepilogo[1].Imposta`. */
  path: string;
  message: string;
}

/** Options of {@link checkBusinessRules}. */
export interface BusinessRuleOptions {
  /** Reference date for 00403 (invoice date after reception). Default: today (UTC). `YYYY-MM-DD`. */
  today?: string;
}

const TD_SAME_PARTY_FORBIDDEN = new Set([
  'TD01',
  'TD02',
  'TD03',
  'TD06',
  'TD16',
  'TD17',
  'TD18',
  'TD19',
  'TD20',
  'TD24',
  'TD25',
  'TD28',
  'TD29',
]);
const TD_SAME_PARTY_REQUIRED = new Set(['TD21', 'TD27']);
const TD_BUYER_VAT_REQUIRED = new Set([
  'TD16',
  'TD17',
  'TD18',
  'TD19',
  'TD20',
  'TD22',
  'TD23',
  'TD28',
  'TD29',
]);
const TD_FOREIGN_SELLER = new Set(['TD17', 'TD18', 'TD19', 'TD28']);

function dec(value: Num | undefined): Decimal | undefined {
  if (value === undefined) return undefined;
  try {
    return Decimal.from(value);
  } catch {
    return undefined;
  }
}

function sameId(a: IdFiscale | undefined, b: IdFiscale | undefined): boolean {
  return a !== undefined && b !== undefined && a.IdPaese === b.IdPaese && a.IdCodice === b.IdCodice;
}

function rateKey(value: Num): string {
  return dec(value)?.toFixed(2) ?? String(value);
}

/**
 * Checks the content rules the SDI applies before accepting an ordinary invoice (Allegato A 1.9.1,
 * Appendice 1, "Verifica di coerenza sul contenuto"), plus offline checks of fiscal identifiers.
 *
 * It does not replace the SDI: checks that need the Anagrafe Tributaria or SDI history (existence of
 * VAT numbers and recipient codes, VAT groups, duplicates 00404/00409, letters of intent 00477) and
 * signature checks cannot run offline. Run it on a model already passed through {@link computeTotals}.
 *
 * Covered codes: 00400 00401 00403 00411 00413 00414 00415 00417 00418 00419 00420 00421 00422 00423 00424
 * 00425 00427 00428 00429 00430 00437 00438 00443 00444 00445 00471 00472 00473 00474 00475 00476 00313,
 * and check digits of IdCodice/CodiceFiscale (00301, 00305, 00306, reported as warnings: the SDI checks
 * the register, not the check digit).
 */
export function checkBusinessRules(
  invoice: FatturaElettronica,
  options: BusinessRuleOptions = {},
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const add = (code: string, path: string, detail?: string, severity: RuleIssue['severity'] = 'error') => {
    const official = describeSdiError(code);
    issues.push({ code, severity, path, message: [official, detail].filter(Boolean).join(': ') });
  };
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const h = invoice.FatturaElettronicaHeader;
  const t = h.DatiTrasmissione;
  const seller = h.CedentePrestatore.DatiAnagrafici;
  const buyer = h.CessionarioCommittente.DatiAnagrafici;

  // 00428: FormatoTrasmissione must match the versione attribute.
  if (t.FormatoTrasmissione !== undefined && t.FormatoTrasmissione !== invoice.versione) {
    add('00428', 'FatturaElettronicaHeader.DatiTrasmissione.FormatoTrasmissione');
  }
  // 00427: 7-character CodiceDestinatario with FPA12, or 6 characters with FPR12.
  const formato = t.FormatoTrasmissione ?? invoice.versione;
  if (
    (formato === 'FPA12' && t.CodiceDestinatario.length === 7) ||
    (formato === 'FPR12' && t.CodiceDestinatario.length === 6)
  ) {
    add('00427', 'FatturaElettronicaHeader.DatiTrasmissione.CodiceDestinatario');
  }
  // 00313: XXXXXXX only for foreign buyers with an IdFiscaleIVA.
  if (t.CodiceDestinatario === 'XXXXXXX' && (!buyer.IdFiscaleIVA || buyer.IdFiscaleIVA.IdPaese === 'IT')) {
    add('00313', 'FatturaElettronicaHeader.DatiTrasmissione.CodiceDestinatario');
  }
  // 00417: buyer needs IdFiscaleIVA or CodiceFiscale.
  if (!buyer.IdFiscaleIVA && !buyer.CodiceFiscale) {
    add('00417', 'FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici');
  }
  // 00476: seller and buyer cannot both be foreign.
  if (seller.IdFiscaleIVA.IdPaese !== 'IT' && buyer.IdFiscaleIVA && buyer.IdFiscaleIVA.IdPaese !== 'IT') {
    add('00476', 'FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.IdFiscaleIVA.IdPaese');
  }
  // Offline identifier checks (warnings).
  if (seller.IdFiscaleIVA.IdPaese === 'IT' && !isValidPartitaIva(seller.IdFiscaleIVA.IdCodice)) {
    add(
      '00301',
      'FatturaElettronicaHeader.CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdCodice',
      'check digit or format of the partita IVA is wrong',
      'warning',
    );
  }
  if (buyer.IdFiscaleIVA?.IdPaese === 'IT' && !isValidPartitaIva(buyer.IdFiscaleIVA.IdCodice)) {
    add(
      '00305',
      'FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.IdFiscaleIVA.IdCodice',
      'check digit or format of the partita IVA is wrong',
      'warning',
    );
  }
  if (
    !buyer.IdFiscaleIVA &&
    buyer.CodiceFiscale !== undefined &&
    !isValidCodiceFiscale(buyer.CodiceFiscale)
  ) {
    add(
      '00306',
      'FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.CodiceFiscale',
      'check character or format of the codice fiscale is wrong',
      'warning',
    );
  }

  invoice.FatturaElettronicaBody.forEach((body, i) =>
    checkBody(body, `FatturaElettronicaBody[${i}]`, invoice, today, add),
  );
  return issues;
}

function checkBody(
  body: FatturaElettronicaBody,
  p: string,
  invoice: FatturaElettronica,
  today: string,
  add: (code: string, path: string, detail?: string, severity?: RuleIssue['severity']) => void,
): void {
  const h = invoice.FatturaElettronicaHeader;
  const seller = h.CedentePrestatore.DatiAnagrafici;
  const buyer = h.CessionarioCommittente.DatiAnagrafici;
  const d = body.DatiGenerali.DatiGeneraliDocumento;
  const dp = `${p}.DatiGenerali.DatiGeneraliDocumento`;
  const td = d.TipoDocumento;
  const lines = body.DatiBeniServizi.DettaglioLinee;
  const riepilogo = body.DatiBeniServizi.DatiRiepilogo ?? [];
  const casse = d.DatiCassaPrevidenziale ?? [];

  // 00403: invoice date after the reception date.
  if (d.Data > today) add('00403', `${dp}.Data`);
  // 00425: Numero must contain a digit.
  if (!/\d/.test(d.Numero)) add('00425', `${dp}.Numero`);
  // 00418: invoice date before the date of a linked invoice.
  (body.DatiGenerali.DatiFattureCollegate ?? []).forEach((c, j) => {
    if (c.Data !== undefined && d.Data < c.Data)
      add('00418', `${p}.DatiGenerali.DatiFattureCollegate[${j}].Data`);
  });

  // Document-type constraints.
  if (TD_SAME_PARTY_FORBIDDEN.has(td) && sameId(seller.IdFiscaleIVA, buyer.IdFiscaleIVA))
    add('00471', `${dp}.TipoDocumento`);
  if (TD_SAME_PARTY_REQUIRED.has(td) && !sameId(seller.IdFiscaleIVA, buyer.IdFiscaleIVA))
    add('00472', `${dp}.TipoDocumento`);
  if (TD_FOREIGN_SELLER.has(td) && seller.IdFiscaleIVA.IdPaese === 'IT')
    add('00473', 'FatturaElettronicaHeader.CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdPaese');
  if (td === 'TD29' && seller.IdFiscaleIVA.IdPaese !== 'IT')
    add('00473', 'FatturaElettronicaHeader.CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdPaese');
  if (TD_BUYER_VAT_REQUIRED.has(td) && !buyer.IdFiscaleIVA)
    add('00475', 'FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.IdFiscaleIVA');

  // Withholding: 00411 / 00415.
  const hasRitenuta = (d.DatiRitenuta ?? []).length > 0;
  if (!hasRitenuta && lines.some((l) => l.Ritenuta === 'SI')) add('00411', `${dp}.DatiRitenuta`);
  if (!hasRitenuta && casse.some((c) => c.Ritenuta === 'SI')) add('00415', `${dp}.DatiRitenuta`);

  // Discounts without amount or percentage: 00437 / 00438.
  (d.ScontoMaggiorazione ?? []).forEach((s, j) => {
    if (s.Percentuale === undefined && s.Importo === undefined)
      add('00437', `${dp}.ScontoMaggiorazione[${j}]`);
  });

  const checkNatura = (path: string, natura: string | undefined) => {
    // 00445: generic N2, N3, N6 no longer allowed.
    if (natura === 'N2' || natura === 'N3' || natura === 'N6') add('00445', path);
    else if (natura !== undefined && !(natura in NATURA)) add('LOCAL', path, `unknown Natura "${natura}"`);
  };
  const checkRate = (path: string, rate: Num) => {
    const r = dec(rate);
    if (!r) return add('LOCAL', path, 'AliquotaIVA is not a number');
    // 00424: rate given as a fraction (0.22) instead of a percentage (22.00).
    if (r.sign() > 0 && r.cmp(1) < 0) add('00424', path);
  };

  // Pension fund contributions: 00413 / 00414.
  casse.forEach((c, j) => {
    const cp = `${dp}.DatiCassaPrevidenziale[${j}]`;
    checkRate(`${cp}.AliquotaIVA`, c.AliquotaIVA);
    const zero = dec(c.AliquotaIVA)?.isZero() ?? false;
    if (zero && c.Natura === undefined) add('00413', `${cp}.Natura`);
    if (!zero && c.Natura !== undefined) add('00414', `${cp}.Natura`);
    checkNatura(`${cp}.Natura`, c.Natura);
  });

  // Lines: 00400 / 00401 / 00423 / 00438 / 00474.
  lines.forEach((l, j) => {
    const lp = `${p}.DatiBeniServizi.DettaglioLinee[${j}]`;
    checkRate(`${lp}.AliquotaIVA`, l.AliquotaIVA);
    const zero = dec(l.AliquotaIVA)?.isZero() ?? false;
    if (zero && l.Natura === undefined) add('00400', `${lp}.Natura`);
    if (!zero && l.Natura !== undefined && td !== 'TD16') add('00401', `${lp}.Natura`);
    if (td === 'TD21' && zero) add('00474', `${lp}.AliquotaIVA`);
    checkNatura(`${lp}.Natura`, l.Natura);
    (l.ScontoMaggiorazione ?? []).forEach((s, k) => {
      if (s.Percentuale === undefined && s.Importo === undefined)
        add('00438', `${lp}.ScontoMaggiorazione[${k}]`);
    });
    if (l.PrezzoTotale !== undefined) {
      try {
        const expected = applyScontoMaggiorazione(l.PrezzoUnitario, l.ScontoMaggiorazione).mul(
          l.Quantita ?? 1,
        );
        if (expected.sub(l.PrezzoTotale).abs().cmp('0.01') > 0) {
          add('00423', `${lp}.PrezzoTotale`, `expected ${expected.toFixedRange(2, 8)} ± 0.01`);
        }
      } catch {
        add('LOCAL', lp, 'amounts are not numbers');
      }
    }
  });

  // Summaries: 00429 / 00430 / 00420 / 00421.
  riepilogo.forEach((r, j) => {
    const rp = `${p}.DatiBeniServizi.DatiRiepilogo[${j}]`;
    checkRate(`${rp}.AliquotaIVA`, r.AliquotaIVA);
    const zero = dec(r.AliquotaIVA)?.isZero() ?? false;
    if (zero && r.Natura === undefined) add('00429', `${rp}.Natura`);
    if (!zero && r.Natura !== undefined && td !== 'TD16') add('00430', `${rp}.Natura`);
    if (r.Natura?.startsWith('N6') && r.EsigibilitaIVA === 'S') add('00420', `${rp}.EsigibilitaIVA`);
    checkNatura(`${rp}.Natura`, r.Natura);
    const imponibile = dec(r.ImponibileImporto);
    const imposta = dec(r.Imposta);
    if (imponibile && imposta && dec(r.AliquotaIVA)) {
      const expected = computeImposta(r.AliquotaIVA, imponibile);
      if (expected.sub(imposta).abs().cmp('0.01') > 0)
        add('00421', `${rp}.Imposta`, `expected ${expected.toFixed(2)} ± 0.01`);
    }
  });

  // Cross checks between lines/contributions and summaries: 00419 / 00443 / 00444 / 00422.
  const summaryRates = new Set(riepilogo.map((r) => rateKey(r.AliquotaIVA)));
  const summaryNature = new Set(riepilogo.map((r) => r.Natura).filter((n) => n !== undefined));
  const usedRates = [...lines.map((l) => l.AliquotaIVA), ...casse.map((c) => c.AliquotaIVA)].map(rateKey);
  const missingRates = [...new Set(usedRates)].filter((r) => !summaryRates.has(r));
  if (missingRates.length > 0) {
    add('00419', `${p}.DatiBeniServizi.DatiRiepilogo`, `missing rate(s) ${missingRates.join(', ')}`);
    add('00443', `${p}.DatiBeniServizi.DatiRiepilogo`);
  }
  const missingNature = [...new Set([...lines.map((l) => l.Natura), ...casse.map((c) => c.Natura)])].filter(
    (n) => n !== undefined && !summaryNature.has(n),
  );
  if (missingNature.length > 0)
    add('00444', `${p}.DatiBeniServizi.DatiRiepilogo`, `missing Natura ${missingNature.join(', ')}`);

  for (const rate of summaryRates) {
    try {
      const expected = sum([
        ...lines.filter((l) => rateKey(l.AliquotaIVA) === rate).map((l) => l.PrezzoTotale ?? 0),
        ...casse.filter((c) => rateKey(c.AliquotaIVA) === rate).map((c) => c.ImportoContributoCassa),
        ...riepilogo.filter((r) => rateKey(r.AliquotaIVA) === rate).map((r) => r.Arrotondamento ?? 0),
      ]);
      const declared = sum(
        riepilogo.filter((r) => rateKey(r.AliquotaIVA) === rate).map((r) => r.ImponibileImporto),
      );
      if (expected.sub(declared).abs().cmp('1') > 0) {
        add(
          '00422',
          `${p}.DatiBeniServizi.DatiRiepilogo`,
          `rate ${rate}: expected ${expected.round(2).toFixed(2)} ± 1.00`,
        );
      }
    } catch {
      add('LOCAL', `${p}.DatiBeniServizi`, 'amounts are not numbers');
    }
  }
}
