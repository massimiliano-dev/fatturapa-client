import {
  CONDIZIONI_PAGAMENTO,
  ESIGIBILITA_IVA,
  FORMATO_TRASMISSIONE,
  isCode,
  MODALITA_PAGAMENTO,
  NATURA,
  REGIME_FISCALE,
  SOCIO_UNICO,
  SOGGETTO_EMITTENTE,
  STATO_LIQUIDAZIONE,
  TIPO_CASSA,
  TIPO_CESSIONE_PRESTAZIONE,
  TIPO_DOCUMENTO,
  TIPO_RITENUTA,
  TIPO_SCONTO_MAGGIORAZIONE,
  CAUSALE_PAGAMENTO,
} from './codes.js';
import { Decimal } from './decimal.js';
import { FatturaPAModelError } from './errors.js';
import {
  FATTURAPA_NAMESPACE,
  XMLDSIG_NAMESPACE,
  type Anagrafica,
  type DatiDocumentoCorrelato,
  type FatturaElettronica,
  type FatturaElettronicaBody,
  type IdFiscale,
  type Indirizzo,
  type Num,
  type ScontoMaggiorazione,
} from './model.js';

/** Options of {@link buildFatturaXml}. */
export interface BuildOptions {
  /**
   * What to do with text outside the character set allowed by the XSD (Basic Latin or Latin-1):
   * - `strict` (default): throw a {@link FatturaPAModelError} naming the element;
   * - `transliterate`: replace common typographic characters (’ “ ” – — … € and non-breaking spaces) with
   *   ASCII equivalents, then apply the strict check.
   */
  text?: 'strict' | 'transliterate';
  /** Indent the output with two spaces. Default true. Whitespace between elements is not significant. */
  pretty?: boolean;
}

type Charset = 'basic' | 'latin';

const TRANSLITERATIONS: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2026': '...',
  '\u20AC': 'EUR',
  '\u00A0': ' ',
  '\u202F': ' ',
  '\u2022': '-',
};

// XML 1.0 forbids C0 controls other than TAB, LF, CR.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

class Writer {
  readonly #lines: string[] = [];
  #depth = 0;

  constructor(readonly options: Required<BuildOptions>) {}

  open(name: string, attributes = ''): void {
    this.#push(`<${name}${attributes}>`);
    this.#depth += 1;
  }

  close(name: string): void {
    this.#depth -= 1;
    this.#push(`</${name}>`);
  }

  leaf(name: string, value: string): void {
    this.#push(`<${name}>${escapeXml(value)}</${name}>`);
  }

  #push(line: string): void {
    this.#lines.push(this.options.pretty ? `${'  '.repeat(this.#depth)}${line}` : line);
  }

  toString(): string {
    return this.#lines.join(this.options.pretty ? '\n' : '');
  }
}

/** Validates and formats leaf values according to the XSD simple types. */
class Fields {
  constructor(private readonly options: Required<BuildOptions>) {}

  text(path: string, value: string, max: number, charset: Charset, min = 1): string {
    if (typeof value !== 'string') throw new FatturaPAModelError(path, 'must be a string');
    let text = value;
    if (this.options.text === 'transliterate') {
      text = text.replace(
        /[\u2018\u2019\u201A\u201C\u201D\u201E\u2013\u2014\u2026\u20AC\u00A0\u202F\u2022]/g,
        (c) => TRANSLITERATIONS[c] ?? c,
      );
    }
    // xs:normalizedString: TAB, LF and CR are replaced by spaces anyway by an XSD processor.
    text = text.replace(/[\t\n\r]/g, ' ');
    if (XML_INVALID.test(text))
      throw new FatturaPAModelError(path, 'contains control characters not allowed in XML');
    const limit = charset === 'basic' ? 0x7f : 0xff;
    for (const ch of text) {
      if (ch.codePointAt(0)! > limit) {
        throw new FatturaPAModelError(
          path,
          `contains a character outside ${charset === 'basic' ? 'Basic Latin (ASCII)' : 'Latin-1'} (U+${ch
            .codePointAt(0)!
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')}); use { text: 'transliterate' } or remove it`,
        );
      }
    }
    const length = [...text].length;
    if (length < min || length > max) {
      throw new FatturaPAModelError(
        path,
        `length must be between ${min} and ${max} characters (is ${length})`,
      );
    }
    return text;
  }

  pattern(path: string, value: string, re: RegExp, description: string): string {
    if (typeof value !== 'string' || !re.test(value))
      throw new FatturaPAModelError(path, `must be ${description}`);
    return value;
  }

  code<T extends Record<string, string>>(path: string, table: T, value: unknown): string {
    if (!isCode(table, value)) throw new FatturaPAModelError(path, `is not a valid code`);
    return value;
  }

  decimal(path: string, value: Num): Decimal {
    try {
      return Decimal.from(value);
    } catch {
      throw new FatturaPAModelError(path, 'is not a decimal number');
    }
  }

  /** Checks that `value` has at most `max` significant decimals, then formats with `min..max` decimals. */
  #fixed(path: string, value: Num, min: number, max: number, intDigits: number, signed: boolean): string {
    const d = this.decimal(path, value);
    if (!d.round(max).eq(d)) throw new FatturaPAModelError(path, `has more than ${max} decimal digits`);
    if (!signed && d.sign() < 0) throw new FatturaPAModelError(path, 'must not be negative');
    const text = d.toFixedRange(min, max);
    const int = text.replace(/^-/, '').split('.')[0] ?? '';
    if (int.length > intDigits)
      throw new FatturaPAModelError(path, `has more than ${intDigits} integer digits`);
    return text;
  }

  amount2(path: string, value: Num): string {
    return this.#fixed(path, value, 2, 2, 11, true);
  }

  amount8(path: string, value: Num): string {
    return this.#fixed(path, value, 2, 8, 11, true);
  }

  quantita(path: string, value: Num): string {
    return this.#fixed(path, value, 2, 8, 12, false);
  }

  rate(path: string, value: Num): string {
    const text = this.#fixed(path, value, 2, 2, 3, false);
    if (Decimal.from(text).cmp('100') > 0) throw new FatturaPAModelError(path, 'must not exceed 100.00');
    return text;
  }

  peso(path: string, value: Num): string {
    const text = this.#fixed(path, value, 1, 2, 4, false);
    return text;
  }

  integer(path: string, value: number, min: number, max: number): string {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new FatturaPAModelError(path, `must be an integer between ${min} and ${max}`);
    }
    return String(value);
  }

  date(path: string, value: string, minYear = 1): string {
    const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!match) throw new FatturaPAModelError(path, 'must be a date YYYY-MM-DD');
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d ||
      y < minYear
    ) {
      throw new FatturaPAModelError(path, 'is not a valid calendar date');
    }
    return value;
  }

  dateTime(path: string, value: string): string {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
    ) {
      throw new FatturaPAModelError(path, 'must be a date-time YYYY-MM-DDThh:mm:ss');
    }
    return value;
  }
}

const NAZIONE = /^[A-Z]{2}$/;
const PROVINCIA = /^[A-Z]{2}$/;

/**
 * Serialises a {@link FatturaElettronica} to FatturaPA XML (schema 1.2.3), UTF-8, unsigned.
 *
 * Every value is checked against the XSD facets before it is written (lengths, character sets, decimal
 * precision, code lists, dates), and the elements are emitted in schema order, so the output is valid
 * against the XSD whenever the model is complete. Business rules (totals, VAT natures, document-type
 * constraints) are checked separately by {@link checkBusinessRules}; run {@link computeTotals} first to
 * fill PrezzoTotale and DatiRiepilogo.
 *
 * As required by the schema, only the root element is namespace-qualified; children are unqualified.
 *
 * @throws {FatturaPAModelError} naming the first invalid element.
 */
export function buildFatturaXml(invoice: FatturaElettronica, options: BuildOptions = {}): string {
  const opts: Required<BuildOptions> = { text: options.text ?? 'strict', pretty: options.pretty ?? true };
  const w = new Writer(opts);
  const f = new Fields(opts);

  const versione = f.code('versione', FORMATO_TRASMISSIONE, invoice.versione);
  const attrs = [
    ` xmlns:p="${FATTURAPA_NAMESPACE}"`,
    ` xmlns:ds="${XMLDSIG_NAMESPACE}"`,
    ` versione="${versione}"`,
    invoice.SistemaEmittente === undefined
      ? ''
      : ` SistemaEmittente="${escapeXml(f.text('SistemaEmittente', invoice.SistemaEmittente, 10, 'basic'))}"`,
  ].join('');

  w.open('p:FatturaElettronica', attrs);
  writeHeader(w, f, invoice, versione);
  if (!Array.isArray(invoice.FatturaElettronicaBody) || invoice.FatturaElettronicaBody.length === 0) {
    throw new FatturaPAModelError('FatturaElettronicaBody', 'at least one body is required');
  }
  invoice.FatturaElettronicaBody.forEach((body, i) => writeBody(w, f, body, `FatturaElettronicaBody[${i}]`));
  w.close('p:FatturaElettronica');

  return `<?xml version="1.0" encoding="UTF-8"?>${opts.pretty ? '\n' : ''}${w.toString()}${opts.pretty ? '\n' : ''}`;
}

function opt<T>(value: T | undefined, write: (v: T) => void): void {
  if (value !== undefined && value !== null) write(value);
}

function list<T>(
  values: T[] | undefined,
  path: string,
  write: (v: T, p: string) => void,
  max = Infinity,
): void {
  if (values === undefined) return;
  if (!Array.isArray(values)) throw new FatturaPAModelError(path, 'must be an array');
  if (values.length > max) throw new FatturaPAModelError(path, `at most ${max} items`);
  values.forEach((v, i) => write(v, `${path}[${i}]`));
}

function idFiscale(w: Writer, f: Fields, name: string, id: IdFiscale, path: string): void {
  if (!id) throw new FatturaPAModelError(path, 'is required');
  w.open(name);
  w.leaf('IdPaese', f.pattern(`${path}.IdPaese`, id.IdPaese, NAZIONE, 'an ISO 3166-1 alpha-2 code'));
  w.leaf('IdCodice', f.text(`${path}.IdCodice`, id.IdCodice, 28, 'basic'));
  w.close(name);
}

function codiceFiscale(f: Fields, path: string, value: string): string {
  return f.pattern(path, value, /^[A-Z0-9]{11,16}$/, '11 to 16 upper-case letters or digits');
}

function anagrafica(w: Writer, f: Fields, a: Anagrafica, path: string): void {
  if (!a) throw new FatturaPAModelError(path, 'is required');
  w.open('Anagrafica');
  if (a.Denominazione !== undefined) {
    if (a.Nome !== undefined || a.Cognome !== undefined) {
      throw new FatturaPAModelError(path, 'use either Denominazione or Nome + Cognome, not both');
    }
    w.leaf('Denominazione', f.text(`${path}.Denominazione`, a.Denominazione, 80, 'latin'));
  } else {
    if (a.Nome === undefined || a.Cognome === undefined) {
      throw new FatturaPAModelError(path, 'requires Denominazione, or both Nome and Cognome');
    }
    w.leaf('Nome', f.text(`${path}.Nome`, a.Nome, 60, 'latin'));
    w.leaf('Cognome', f.text(`${path}.Cognome`, a.Cognome, 60, 'latin'));
  }
  opt(a.Titolo, (v) => w.leaf('Titolo', f.text(`${path}.Titolo`, v, 10, 'basic', 2)));
  opt(a.CodEORI, (v) => w.leaf('CodEORI', f.text(`${path}.CodEORI`, v, 17, 'basic', 13)));
  w.close('Anagrafica');
}

function indirizzo(w: Writer, f: Fields, name: string, a: Indirizzo, path: string): void {
  if (!a) throw new FatturaPAModelError(path, 'is required');
  w.open(name);
  w.leaf('Indirizzo', f.text(`${path}.Indirizzo`, a.Indirizzo, 60, 'latin'));
  opt(a.NumeroCivico, (v) => w.leaf('NumeroCivico', f.text(`${path}.NumeroCivico`, v, 8, 'basic')));
  w.leaf('CAP', f.pattern(`${path}.CAP`, a.CAP, /^\d{5}$/, 'five digits (use 00000 abroad)'));
  w.leaf('Comune', f.text(`${path}.Comune`, a.Comune, 60, 'latin'));
  opt(a.Provincia, (v) =>
    w.leaf('Provincia', f.pattern(`${path}.Provincia`, v, PROVINCIA, 'two upper-case letters')),
  );
  w.leaf('Nazione', f.pattern(`${path}.Nazione`, a.Nazione, NAZIONE, 'an ISO 3166-1 alpha-2 code'));
  w.close(name);
}

const EMAIL_CONTATTI = /^.+@.+[.]+.+$/;

function writeHeader(w: Writer, f: Fields, invoice: FatturaElettronica, versione: string): void {
  const h = invoice.FatturaElettronicaHeader;
  const p = 'FatturaElettronicaHeader';
  if (!h) throw new FatturaPAModelError(p, 'is required');
  w.open('FatturaElettronicaHeader');

  // 1.1 DatiTrasmissione
  const t = h.DatiTrasmissione;
  const tp = `${p}.DatiTrasmissione`;
  if (!t) throw new FatturaPAModelError(tp, 'is required');
  w.open('DatiTrasmissione');
  idFiscale(w, f, 'IdTrasmittente', t.IdTrasmittente, `${tp}.IdTrasmittente`);
  w.leaf('ProgressivoInvio', f.text(`${tp}.ProgressivoInvio`, t.ProgressivoInvio, 10, 'basic'));
  const formato = t.FormatoTrasmissione ?? versione;
  if (formato !== versione) {
    // 00428: FormatoTrasmissione non coerente con il valore dell'attributo versione.
    throw new FatturaPAModelError(
      `${tp}.FormatoTrasmissione`,
      `must equal the root versione (${versione}) (SDI 00428)`,
    );
  }
  w.leaf('FormatoTrasmissione', f.code(`${tp}.FormatoTrasmissione`, FORMATO_TRASMISSIONE, formato));
  w.leaf(
    'CodiceDestinatario',
    f.pattern(
      `${tp}.CodiceDestinatario`,
      t.CodiceDestinatario,
      /^[A-Z0-9]{6,7}$/,
      '6 or 7 upper-case letters or digits',
    ),
  );
  opt(t.ContattiTrasmittente, (c) => {
    w.open('ContattiTrasmittente');
    opt(c.Telefono, (v) =>
      w.leaf('Telefono', f.text(`${tp}.ContattiTrasmittente.Telefono`, v, 12, 'basic', 5)),
    );
    opt(c.Email, (v) =>
      w.leaf(
        'Email',
        f.pattern(
          `${tp}.ContattiTrasmittente.Email`,
          f.text(`${tp}.ContattiTrasmittente.Email`, v, 256, 'basic', 7),
          EMAIL_CONTATTI,
          'an e-mail address',
        ),
      ),
    );
    w.close('ContattiTrasmittente');
  });
  opt(t.PECDestinatario, (v) =>
    w.leaf(
      'PECDestinatario',
      f.pattern(
        `${tp}.PECDestinatario`,
        f.text(`${tp}.PECDestinatario`, v, 256, 'basic', 7),
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
        'an e-mail address',
      ),
    ),
  );
  w.close('DatiTrasmissione');

  // 1.2 CedentePrestatore
  const c = h.CedentePrestatore;
  const cp = `${p}.CedentePrestatore`;
  if (!c) throw new FatturaPAModelError(cp, 'is required');
  w.open('CedentePrestatore');
  const da = c.DatiAnagrafici;
  if (!da) throw new FatturaPAModelError(`${cp}.DatiAnagrafici`, 'is required');
  w.open('DatiAnagrafici');
  idFiscale(w, f, 'IdFiscaleIVA', da.IdFiscaleIVA, `${cp}.DatiAnagrafici.IdFiscaleIVA`);
  opt(da.CodiceFiscale, (v) =>
    w.leaf('CodiceFiscale', codiceFiscale(f, `${cp}.DatiAnagrafici.CodiceFiscale`, v)),
  );
  anagrafica(w, f, da.Anagrafica, `${cp}.DatiAnagrafici.Anagrafica`);
  opt(da.AlboProfessionale, (v) =>
    w.leaf('AlboProfessionale', f.text(`${cp}.DatiAnagrafici.AlboProfessionale`, v, 60, 'latin')),
  );
  opt(da.ProvinciaAlbo, (v) =>
    w.leaf(
      'ProvinciaAlbo',
      f.pattern(`${cp}.DatiAnagrafici.ProvinciaAlbo`, v, PROVINCIA, 'two upper-case letters'),
    ),
  );
  opt(da.NumeroIscrizioneAlbo, (v) =>
    w.leaf('NumeroIscrizioneAlbo', f.text(`${cp}.DatiAnagrafici.NumeroIscrizioneAlbo`, v, 60, 'basic')),
  );
  opt(da.DataIscrizioneAlbo, (v) =>
    w.leaf('DataIscrizioneAlbo', f.date(`${cp}.DatiAnagrafici.DataIscrizioneAlbo`, v)),
  );
  w.leaf('RegimeFiscale', f.code(`${cp}.DatiAnagrafici.RegimeFiscale`, REGIME_FISCALE, da.RegimeFiscale));
  w.close('DatiAnagrafici');
  indirizzo(w, f, 'Sede', c.Sede, `${cp}.Sede`);
  opt(c.StabileOrganizzazione, (v) =>
    indirizzo(w, f, 'StabileOrganizzazione', v, `${cp}.StabileOrganizzazione`),
  );
  opt(c.IscrizioneREA, (r) => {
    const rp = `${cp}.IscrizioneREA`;
    w.open('IscrizioneREA');
    w.leaf('Ufficio', f.pattern(`${rp}.Ufficio`, r.Ufficio, PROVINCIA, 'two upper-case letters'));
    w.leaf('NumeroREA', f.text(`${rp}.NumeroREA`, r.NumeroREA, 20, 'basic'));
    opt(r.CapitaleSociale, (v) => w.leaf('CapitaleSociale', f.amount2(`${rp}.CapitaleSociale`, v)));
    opt(r.SocioUnico, (v) => w.leaf('SocioUnico', f.code(`${rp}.SocioUnico`, SOCIO_UNICO, v)));
    w.leaf('StatoLiquidazione', f.code(`${rp}.StatoLiquidazione`, STATO_LIQUIDAZIONE, r.StatoLiquidazione));
    w.close('IscrizioneREA');
  });
  opt(c.Contatti, (k) => {
    w.open('Contatti');
    opt(k.Telefono, (v) => w.leaf('Telefono', f.text(`${cp}.Contatti.Telefono`, v, 12, 'basic', 5)));
    opt(k.Fax, (v) => w.leaf('Fax', f.text(`${cp}.Contatti.Fax`, v, 12, 'basic', 5)));
    opt(k.Email, (v) =>
      w.leaf(
        'Email',
        f.pattern(
          `${cp}.Contatti.Email`,
          f.text(`${cp}.Contatti.Email`, v, 256, 'basic', 7),
          EMAIL_CONTATTI,
          'an e-mail address',
        ),
      ),
    );
    w.close('Contatti');
  });
  opt(c.RiferimentoAmministrazione, (v) =>
    w.leaf('RiferimentoAmministrazione', f.text(`${cp}.RiferimentoAmministrazione`, v, 20, 'basic')),
  );
  w.close('CedentePrestatore');

  // 1.3 RappresentanteFiscale
  opt(h.RappresentanteFiscale, (r) => {
    const rp = `${p}.RappresentanteFiscale.DatiAnagrafici`;
    w.open('RappresentanteFiscale');
    w.open('DatiAnagrafici');
    idFiscale(w, f, 'IdFiscaleIVA', r.DatiAnagrafici.IdFiscaleIVA, `${rp}.IdFiscaleIVA`);
    opt(r.DatiAnagrafici.CodiceFiscale, (v) =>
      w.leaf('CodiceFiscale', codiceFiscale(f, `${rp}.CodiceFiscale`, v)),
    );
    anagrafica(w, f, r.DatiAnagrafici.Anagrafica, `${rp}.Anagrafica`);
    w.close('DatiAnagrafici');
    w.close('RappresentanteFiscale');
  });

  // 1.4 CessionarioCommittente
  const k = h.CessionarioCommittente;
  const kp = `${p}.CessionarioCommittente`;
  if (!k) throw new FatturaPAModelError(kp, 'is required');
  w.open('CessionarioCommittente');
  w.open('DatiAnagrafici');
  if (!k.DatiAnagrafici) throw new FatturaPAModelError(`${kp}.DatiAnagrafici`, 'is required');
  opt(k.DatiAnagrafici.IdFiscaleIVA, (v) =>
    idFiscale(w, f, 'IdFiscaleIVA', v, `${kp}.DatiAnagrafici.IdFiscaleIVA`),
  );
  opt(k.DatiAnagrafici.CodiceFiscale, (v) =>
    w.leaf('CodiceFiscale', codiceFiscale(f, `${kp}.DatiAnagrafici.CodiceFiscale`, v)),
  );
  anagrafica(w, f, k.DatiAnagrafici.Anagrafica, `${kp}.DatiAnagrafici.Anagrafica`);
  w.close('DatiAnagrafici');
  indirizzo(w, f, 'Sede', k.Sede, `${kp}.Sede`);
  opt(k.StabileOrganizzazione, (v) =>
    indirizzo(w, f, 'StabileOrganizzazione', v, `${kp}.StabileOrganizzazione`),
  );
  opt(k.RappresentanteFiscale, (r) => {
    const rp = `${kp}.RappresentanteFiscale`;
    w.open('RappresentanteFiscale');
    idFiscale(w, f, 'IdFiscaleIVA', r.IdFiscaleIVA, `${rp}.IdFiscaleIVA`);
    if (r.Denominazione !== undefined) {
      if (r.Nome !== undefined || r.Cognome !== undefined) {
        throw new FatturaPAModelError(rp, 'use either Denominazione or Nome + Cognome, not both');
      }
      w.leaf('Denominazione', f.text(`${rp}.Denominazione`, r.Denominazione, 80, 'latin'));
    } else {
      if (r.Nome === undefined || r.Cognome === undefined) {
        throw new FatturaPAModelError(rp, 'requires Denominazione, or both Nome and Cognome');
      }
      w.leaf('Nome', f.text(`${rp}.Nome`, r.Nome, 60, 'latin'));
      w.leaf('Cognome', f.text(`${rp}.Cognome`, r.Cognome, 60, 'latin'));
    }
    w.close('RappresentanteFiscale');
  });
  w.close('CessionarioCommittente');

  // 1.5 TerzoIntermediarioOSoggettoEmittente
  opt(h.TerzoIntermediarioOSoggettoEmittente, (t3) => {
    const tp3 = `${p}.TerzoIntermediarioOSoggettoEmittente.DatiAnagrafici`;
    w.open('TerzoIntermediarioOSoggettoEmittente');
    w.open('DatiAnagrafici');
    opt(t3.DatiAnagrafici.IdFiscaleIVA, (v) => idFiscale(w, f, 'IdFiscaleIVA', v, `${tp3}.IdFiscaleIVA`));
    opt(t3.DatiAnagrafici.CodiceFiscale, (v) =>
      w.leaf('CodiceFiscale', codiceFiscale(f, `${tp3}.CodiceFiscale`, v)),
    );
    anagrafica(w, f, t3.DatiAnagrafici.Anagrafica, `${tp3}.Anagrafica`);
    w.close('DatiAnagrafici');
    w.close('TerzoIntermediarioOSoggettoEmittente');
  });
  opt(h.SoggettoEmittente, (v) =>
    w.leaf('SoggettoEmittente', f.code(`${p}.SoggettoEmittente`, SOGGETTO_EMITTENTE, v)),
  );
  w.close('FatturaElettronicaHeader');
}

function scontoMaggiorazione(w: Writer, f: Fields, s: ScontoMaggiorazione, path: string): void {
  w.open('ScontoMaggiorazione');
  w.leaf('Tipo', f.code(`${path}.Tipo`, TIPO_SCONTO_MAGGIORAZIONE, s.Tipo));
  opt(s.Percentuale, (v) => w.leaf('Percentuale', f.rate(`${path}.Percentuale`, v)));
  opt(s.Importo, (v) => w.leaf('Importo', f.amount8(`${path}.Importo`, v)));
  w.close('ScontoMaggiorazione');
}

function documentoCorrelato(
  w: Writer,
  f: Fields,
  name: string,
  d: DatiDocumentoCorrelato,
  path: string,
): void {
  w.open(name);
  list(d.RiferimentoNumeroLinea, `${path}.RiferimentoNumeroLinea`, (v, p) =>
    w.leaf('RiferimentoNumeroLinea', f.integer(p, v, 1, 9999)),
  );
  w.leaf('IdDocumento', f.text(`${path}.IdDocumento`, d.IdDocumento, 20, 'basic'));
  opt(d.Data, (v) => w.leaf('Data', f.date(`${path}.Data`, v)));
  opt(d.NumItem, (v) => w.leaf('NumItem', f.text(`${path}.NumItem`, v, 20, 'basic')));
  opt(d.CodiceCommessaConvenzione, (v) =>
    w.leaf('CodiceCommessaConvenzione', f.text(`${path}.CodiceCommessaConvenzione`, v, 100, 'latin')),
  );
  opt(d.CodiceCUP, (v) => w.leaf('CodiceCUP', f.text(`${path}.CodiceCUP`, v, 15, 'basic')));
  opt(d.CodiceCIG, (v) => w.leaf('CodiceCIG', f.text(`${path}.CodiceCIG`, v, 15, 'basic')));
  w.close(name);
}

function writeBody(w: Writer, f: Fields, body: FatturaElettronicaBody, p: string): void {
  if (!body) throw new FatturaPAModelError(p, 'is required');
  w.open('FatturaElettronicaBody');

  // 2.1 DatiGenerali
  const g = body.DatiGenerali;
  const gp = `${p}.DatiGenerali`;
  if (!g?.DatiGeneraliDocumento) throw new FatturaPAModelError(`${gp}.DatiGeneraliDocumento`, 'is required');
  const d = g.DatiGeneraliDocumento;
  const dp = `${gp}.DatiGeneraliDocumento`;
  w.open('DatiGenerali');
  w.open('DatiGeneraliDocumento');
  w.leaf('TipoDocumento', f.code(`${dp}.TipoDocumento`, TIPO_DOCUMENTO, d.TipoDocumento));
  w.leaf('Divisa', f.pattern(`${dp}.Divisa`, d.Divisa, /^[A-Z]{3}$/, 'an ISO 4217 currency code'));
  w.leaf('Data', f.date(`${dp}.Data`, d.Data, 1970));
  w.leaf('Numero', f.text(`${dp}.Numero`, d.Numero, 20, 'basic'));
  list(d.DatiRitenuta, `${dp}.DatiRitenuta`, (r, rp) => {
    w.open('DatiRitenuta');
    w.leaf('TipoRitenuta', f.code(`${rp}.TipoRitenuta`, TIPO_RITENUTA, r.TipoRitenuta));
    w.leaf('ImportoRitenuta', f.amount2(`${rp}.ImportoRitenuta`, r.ImportoRitenuta));
    w.leaf('AliquotaRitenuta', f.rate(`${rp}.AliquotaRitenuta`, r.AliquotaRitenuta));
    w.leaf('CausalePagamento', f.code(`${rp}.CausalePagamento`, CAUSALE_PAGAMENTO, r.CausalePagamento));
    w.close('DatiRitenuta');
  });
  opt(d.DatiBollo, (b) => {
    w.open('DatiBollo');
    if (b.BolloVirtuale !== 'SI')
      throw new FatturaPAModelError(`${dp}.DatiBollo.BolloVirtuale`, 'must be "SI"');
    w.leaf('BolloVirtuale', 'SI');
    opt(b.ImportoBollo, (v) => w.leaf('ImportoBollo', f.amount2(`${dp}.DatiBollo.ImportoBollo`, v)));
    w.close('DatiBollo');
  });
  list(d.DatiCassaPrevidenziale, `${dp}.DatiCassaPrevidenziale`, (c, cp) => {
    w.open('DatiCassaPrevidenziale');
    w.leaf('TipoCassa', f.code(`${cp}.TipoCassa`, TIPO_CASSA, c.TipoCassa));
    w.leaf('AlCassa', f.rate(`${cp}.AlCassa`, c.AlCassa));
    w.leaf('ImportoContributoCassa', f.amount2(`${cp}.ImportoContributoCassa`, c.ImportoContributoCassa));
    opt(c.ImponibileCassa, (v) => w.leaf('ImponibileCassa', f.amount2(`${cp}.ImponibileCassa`, v)));
    w.leaf('AliquotaIVA', f.rate(`${cp}.AliquotaIVA`, c.AliquotaIVA));
    opt(c.Ritenuta, (v) => {
      if (v !== 'SI') throw new FatturaPAModelError(`${cp}.Ritenuta`, 'must be "SI" or omitted');
      w.leaf('Ritenuta', 'SI');
    });
    opt(c.Natura, (v) => w.leaf('Natura', f.code(`${cp}.Natura`, NATURA, v)));
    opt(c.RiferimentoAmministrazione, (v) =>
      w.leaf('RiferimentoAmministrazione', f.text(`${cp}.RiferimentoAmministrazione`, v, 20, 'basic')),
    );
    w.close('DatiCassaPrevidenziale');
  });
  list(d.ScontoMaggiorazione, `${dp}.ScontoMaggiorazione`, (s, sp) => scontoMaggiorazione(w, f, s, sp));
  opt(d.ImportoTotaleDocumento, (v) =>
    w.leaf('ImportoTotaleDocumento', f.amount2(`${dp}.ImportoTotaleDocumento`, v)),
  );
  opt(d.Arrotondamento, (v) => w.leaf('Arrotondamento', f.amount2(`${dp}.Arrotondamento`, v)));
  list(d.Causale, `${dp}.Causale`, (v, cp) => w.leaf('Causale', f.text(cp, v, 200, 'latin')));
  opt(d.Art73, (v) => {
    if (v !== 'SI') throw new FatturaPAModelError(`${dp}.Art73`, 'must be "SI" or omitted');
    w.leaf('Art73', 'SI');
  });
  w.close('DatiGeneraliDocumento');
  list(g.DatiOrdineAcquisto, `${gp}.DatiOrdineAcquisto`, (v, x) =>
    documentoCorrelato(w, f, 'DatiOrdineAcquisto', v, x),
  );
  list(g.DatiContratto, `${gp}.DatiContratto`, (v, x) => documentoCorrelato(w, f, 'DatiContratto', v, x));
  list(g.DatiConvenzione, `${gp}.DatiConvenzione`, (v, x) =>
    documentoCorrelato(w, f, 'DatiConvenzione', v, x),
  );
  list(g.DatiRicezione, `${gp}.DatiRicezione`, (v, x) => documentoCorrelato(w, f, 'DatiRicezione', v, x));
  list(g.DatiFattureCollegate, `${gp}.DatiFattureCollegate`, (v, x) =>
    documentoCorrelato(w, f, 'DatiFattureCollegate', v, x),
  );
  list(g.DatiSAL, `${gp}.DatiSAL`, (v, x) => {
    w.open('DatiSAL');
    w.leaf('RiferimentoFase', f.integer(`${x}.RiferimentoFase`, v.RiferimentoFase, 1, 999));
    w.close('DatiSAL');
  });
  list(g.DatiDDT, `${gp}.DatiDDT`, (v, x) => {
    w.open('DatiDDT');
    w.leaf('NumeroDDT', f.text(`${x}.NumeroDDT`, v.NumeroDDT, 20, 'basic'));
    w.leaf('DataDDT', f.date(`${x}.DataDDT`, v.DataDDT));
    list(v.RiferimentoNumeroLinea, `${x}.RiferimentoNumeroLinea`, (n, np) =>
      w.leaf('RiferimentoNumeroLinea', f.integer(np, n, 1, 9999)),
    );
    w.close('DatiDDT');
  });
  opt(g.DatiTrasporto, (t) => {
    const tp = `${gp}.DatiTrasporto`;
    w.open('DatiTrasporto');
    opt(t.DatiAnagraficiVettore, (v) => {
      const vp = `${tp}.DatiAnagraficiVettore`;
      w.open('DatiAnagraficiVettore');
      idFiscale(w, f, 'IdFiscaleIVA', v.IdFiscaleIVA, `${vp}.IdFiscaleIVA`);
      opt(v.CodiceFiscale, (x) => w.leaf('CodiceFiscale', codiceFiscale(f, `${vp}.CodiceFiscale`, x)));
      anagrafica(w, f, v.Anagrafica, `${vp}.Anagrafica`);
      opt(v.NumeroLicenzaGuida, (x) =>
        w.leaf('NumeroLicenzaGuida', f.text(`${vp}.NumeroLicenzaGuida`, x, 20, 'basic')),
      );
      w.close('DatiAnagraficiVettore');
    });
    opt(t.MezzoTrasporto, (v) => w.leaf('MezzoTrasporto', f.text(`${tp}.MezzoTrasporto`, v, 80, 'latin')));
    opt(t.CausaleTrasporto, (v) =>
      w.leaf('CausaleTrasporto', f.text(`${tp}.CausaleTrasporto`, v, 100, 'latin')),
    );
    opt(t.NumeroColli, (v) => w.leaf('NumeroColli', f.integer(`${tp}.NumeroColli`, v, 1, 9999)));
    opt(t.Descrizione, (v) => w.leaf('Descrizione', f.text(`${tp}.Descrizione`, v, 100, 'latin')));
    opt(t.UnitaMisuraPeso, (v) => w.leaf('UnitaMisuraPeso', f.text(`${tp}.UnitaMisuraPeso`, v, 10, 'basic')));
    opt(t.PesoLordo, (v) => w.leaf('PesoLordo', f.peso(`${tp}.PesoLordo`, v)));
    opt(t.PesoNetto, (v) => w.leaf('PesoNetto', f.peso(`${tp}.PesoNetto`, v)));
    opt(t.DataOraRitiro, (v) => w.leaf('DataOraRitiro', f.dateTime(`${tp}.DataOraRitiro`, v)));
    opt(t.DataInizioTrasporto, (v) => w.leaf('DataInizioTrasporto', f.date(`${tp}.DataInizioTrasporto`, v)));
    opt(t.TipoResa, (v) =>
      w.leaf(
        'TipoResa',
        f.pattern(`${tp}.TipoResa`, v, /^[A-Z]{3}$/, 'three upper-case letters (Incoterms)'),
      ),
    );
    opt(t.IndirizzoResa, (v) => indirizzo(w, f, 'IndirizzoResa', v, `${tp}.IndirizzoResa`));
    opt(t.DataOraConsegna, (v) => w.leaf('DataOraConsegna', f.dateTime(`${tp}.DataOraConsegna`, v)));
    w.close('DatiTrasporto');
  });
  opt(g.FatturaPrincipale, (v) => {
    w.open('FatturaPrincipale');
    w.leaf(
      'NumeroFatturaPrincipale',
      f.text(`${gp}.FatturaPrincipale.NumeroFatturaPrincipale`, v.NumeroFatturaPrincipale, 20, 'basic'),
    );
    w.leaf(
      'DataFatturaPrincipale',
      f.date(`${gp}.FatturaPrincipale.DataFatturaPrincipale`, v.DataFatturaPrincipale),
    );
    w.close('FatturaPrincipale');
  });
  w.close('DatiGenerali');

  // 2.2 DatiBeniServizi
  const bs = body.DatiBeniServizi;
  const bp = `${p}.DatiBeniServizi`;
  if (!bs || !Array.isArray(bs.DettaglioLinee) || bs.DettaglioLinee.length === 0) {
    throw new FatturaPAModelError(`${bp}.DettaglioLinee`, 'at least one line is required');
  }
  if (!Array.isArray(bs.DatiRiepilogo) || bs.DatiRiepilogo.length === 0) {
    throw new FatturaPAModelError(
      `${bp}.DatiRiepilogo`,
      'is required: call computeTotals() first or fill it in',
    );
  }
  w.open('DatiBeniServizi');
  bs.DettaglioLinee.forEach((l, i) => {
    const lp = `${bp}.DettaglioLinee[${i}]`;
    w.open('DettaglioLinee');
    if (l.NumeroLinea === undefined)
      throw new FatturaPAModelError(
        `${lp}.NumeroLinea`,
        'is required: call computeTotals() first or fill it in',
      );
    w.leaf('NumeroLinea', f.integer(`${lp}.NumeroLinea`, l.NumeroLinea, 1, 9999));
    opt(l.TipoCessionePrestazione, (v) =>
      w.leaf(
        'TipoCessionePrestazione',
        f.code(`${lp}.TipoCessionePrestazione`, TIPO_CESSIONE_PRESTAZIONE, v),
      ),
    );
    list(l.CodiceArticolo, `${lp}.CodiceArticolo`, (c, cp) => {
      w.open('CodiceArticolo');
      w.leaf('CodiceTipo', f.text(`${cp}.CodiceTipo`, c.CodiceTipo, 35, 'basic'));
      w.leaf('CodiceValore', f.text(`${cp}.CodiceValore`, c.CodiceValore, 35, 'latin'));
      w.close('CodiceArticolo');
    });
    w.leaf('Descrizione', f.text(`${lp}.Descrizione`, l.Descrizione, 1000, 'latin'));
    opt(l.Quantita, (v) => w.leaf('Quantita', f.quantita(`${lp}.Quantita`, v)));
    opt(l.UnitaMisura, (v) => w.leaf('UnitaMisura', f.text(`${lp}.UnitaMisura`, v, 10, 'basic')));
    opt(l.DataInizioPeriodo, (v) => w.leaf('DataInizioPeriodo', f.date(`${lp}.DataInizioPeriodo`, v)));
    opt(l.DataFinePeriodo, (v) => w.leaf('DataFinePeriodo', f.date(`${lp}.DataFinePeriodo`, v)));
    w.leaf('PrezzoUnitario', f.amount8(`${lp}.PrezzoUnitario`, l.PrezzoUnitario));
    list(l.ScontoMaggiorazione, `${lp}.ScontoMaggiorazione`, (s, sp) => scontoMaggiorazione(w, f, s, sp));
    if (l.PrezzoTotale === undefined)
      throw new FatturaPAModelError(
        `${lp}.PrezzoTotale`,
        'is required: call computeTotals() first or fill it in',
      );
    w.leaf('PrezzoTotale', f.amount8(`${lp}.PrezzoTotale`, l.PrezzoTotale));
    w.leaf('AliquotaIVA', f.rate(`${lp}.AliquotaIVA`, l.AliquotaIVA));
    opt(l.Ritenuta, (v) => {
      if (v !== 'SI') throw new FatturaPAModelError(`${lp}.Ritenuta`, 'must be "SI" or omitted');
      w.leaf('Ritenuta', 'SI');
    });
    opt(l.Natura, (v) => w.leaf('Natura', f.code(`${lp}.Natura`, NATURA, v)));
    opt(l.RiferimentoAmministrazione, (v) =>
      w.leaf('RiferimentoAmministrazione', f.text(`${lp}.RiferimentoAmministrazione`, v, 20, 'basic')),
    );
    list(l.AltriDatiGestionali, `${lp}.AltriDatiGestionali`, (a, ap) => {
      w.open('AltriDatiGestionali');
      w.leaf('TipoDato', f.text(`${ap}.TipoDato`, a.TipoDato, 10, 'basic'));
      opt(a.RiferimentoTesto, (v) =>
        w.leaf('RiferimentoTesto', f.text(`${ap}.RiferimentoTesto`, v, 60, 'latin')),
      );
      opt(a.RiferimentoNumero, (v) => w.leaf('RiferimentoNumero', f.amount8(`${ap}.RiferimentoNumero`, v)));
      opt(a.RiferimentoData, (v) => w.leaf('RiferimentoData', f.date(`${ap}.RiferimentoData`, v)));
      w.close('AltriDatiGestionali');
    });
    w.close('DettaglioLinee');
  });
  bs.DatiRiepilogo.forEach((r, i) => {
    const rp = `${bp}.DatiRiepilogo[${i}]`;
    w.open('DatiRiepilogo');
    w.leaf('AliquotaIVA', f.rate(`${rp}.AliquotaIVA`, r.AliquotaIVA));
    opt(r.Natura, (v) => w.leaf('Natura', f.code(`${rp}.Natura`, NATURA, v)));
    opt(r.SpeseAccessorie, (v) => w.leaf('SpeseAccessorie', f.amount2(`${rp}.SpeseAccessorie`, v)));
    opt(r.Arrotondamento, (v) => w.leaf('Arrotondamento', f.amount8(`${rp}.Arrotondamento`, v)));
    w.leaf('ImponibileImporto', f.amount2(`${rp}.ImponibileImporto`, r.ImponibileImporto));
    w.leaf('Imposta', f.amount2(`${rp}.Imposta`, r.Imposta));
    opt(r.EsigibilitaIVA, (v) =>
      w.leaf('EsigibilitaIVA', f.code(`${rp}.EsigibilitaIVA`, ESIGIBILITA_IVA, v)),
    );
    opt(r.RiferimentoNormativo, (v) =>
      w.leaf('RiferimentoNormativo', f.text(`${rp}.RiferimentoNormativo`, v, 100, 'latin')),
    );
    w.close('DatiRiepilogo');
  });
  w.close('DatiBeniServizi');

  // 2.3 DatiVeicoli
  opt(body.DatiVeicoli, (v) => {
    w.open('DatiVeicoli');
    w.leaf('Data', f.date(`${p}.DatiVeicoli.Data`, v.Data));
    w.leaf('TotalePercorso', f.text(`${p}.DatiVeicoli.TotalePercorso`, v.TotalePercorso, 15, 'basic'));
    w.close('DatiVeicoli');
  });

  // 2.4 DatiPagamento
  list(body.DatiPagamento, `${p}.DatiPagamento`, (pg, pp) => {
    w.open('DatiPagamento');
    w.leaf(
      'CondizioniPagamento',
      f.code(`${pp}.CondizioniPagamento`, CONDIZIONI_PAGAMENTO, pg.CondizioniPagamento),
    );
    if (!Array.isArray(pg.DettaglioPagamento) || pg.DettaglioPagamento.length === 0) {
      throw new FatturaPAModelError(`${pp}.DettaglioPagamento`, 'at least one item is required');
    }
    pg.DettaglioPagamento.forEach((x, i) => {
      const xp = `${pp}.DettaglioPagamento[${i}]`;
      w.open('DettaglioPagamento');
      opt(x.Beneficiario, (v) => w.leaf('Beneficiario', f.text(`${xp}.Beneficiario`, v, 200, 'latin')));
      w.leaf('ModalitaPagamento', f.code(`${xp}.ModalitaPagamento`, MODALITA_PAGAMENTO, x.ModalitaPagamento));
      opt(x.DataRiferimentoTerminiPagamento, (v) =>
        w.leaf('DataRiferimentoTerminiPagamento', f.date(`${xp}.DataRiferimentoTerminiPagamento`, v)),
      );
      opt(x.GiorniTerminiPagamento, (v) =>
        w.leaf('GiorniTerminiPagamento', f.integer(`${xp}.GiorniTerminiPagamento`, v, 0, 999)),
      );
      opt(x.DataScadenzaPagamento, (v) =>
        w.leaf('DataScadenzaPagamento', f.date(`${xp}.DataScadenzaPagamento`, v)),
      );
      w.leaf('ImportoPagamento', f.amount2(`${xp}.ImportoPagamento`, x.ImportoPagamento));
      opt(x.CodUfficioPostale, (v) =>
        w.leaf('CodUfficioPostale', f.text(`${xp}.CodUfficioPostale`, v, 20, 'basic')),
      );
      opt(x.CognomeQuietanzante, (v) =>
        w.leaf('CognomeQuietanzante', f.text(`${xp}.CognomeQuietanzante`, v, 60, 'latin')),
      );
      opt(x.NomeQuietanzante, (v) =>
        w.leaf('NomeQuietanzante', f.text(`${xp}.NomeQuietanzante`, v, 60, 'latin')),
      );
      opt(x.CFQuietanzante, (v) =>
        w.leaf(
          'CFQuietanzante',
          f.pattern(`${xp}.CFQuietanzante`, v, /^[A-Z0-9]{16}$/, '16 upper-case letters or digits'),
        ),
      );
      opt(x.TitoloQuietanzante, (v) =>
        w.leaf('TitoloQuietanzante', f.text(`${xp}.TitoloQuietanzante`, v, 10, 'basic', 2)),
      );
      opt(x.IstitutoFinanziario, (v) =>
        w.leaf('IstitutoFinanziario', f.text(`${xp}.IstitutoFinanziario`, v, 80, 'latin')),
      );
      opt(x.IBAN, (v) =>
        w.leaf(
          'IBAN',
          f.pattern(`${xp}.IBAN`, v, /^[a-zA-Z]{2}[0-9]{2}[a-zA-Z0-9]{11,30}$/, 'an IBAN without spaces'),
        ),
      );
      opt(x.ABI, (v) => w.leaf('ABI', f.pattern(`${xp}.ABI`, v, /^\d{5}$/, 'five digits')));
      opt(x.CAB, (v) => w.leaf('CAB', f.pattern(`${xp}.CAB`, v, /^\d{5}$/, 'five digits')));
      opt(x.BIC, (v) =>
        w.leaf('BIC', f.pattern(`${xp}.BIC`, v, /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/, 'a BIC')),
      );
      opt(x.ScontoPagamentoAnticipato, (v) =>
        w.leaf('ScontoPagamentoAnticipato', f.amount2(`${xp}.ScontoPagamentoAnticipato`, v)),
      );
      opt(x.DataLimitePagamentoAnticipato, (v) =>
        w.leaf('DataLimitePagamentoAnticipato', f.date(`${xp}.DataLimitePagamentoAnticipato`, v)),
      );
      opt(x.PenalitaPagamentiRitardati, (v) =>
        w.leaf('PenalitaPagamentiRitardati', f.amount2(`${xp}.PenalitaPagamentiRitardati`, v)),
      );
      opt(x.DataDecorrenzaPenale, (v) =>
        w.leaf('DataDecorrenzaPenale', f.date(`${xp}.DataDecorrenzaPenale`, v)),
      );
      opt(x.CodicePagamento, (v) =>
        w.leaf('CodicePagamento', f.text(`${xp}.CodicePagamento`, v, 60, 'basic')),
      );
      w.close('DettaglioPagamento');
    });
    w.close('DatiPagamento');
  });

  // 2.5 Allegati
  list(body.Allegati, `${p}.Allegati`, (a, ap) => {
    if (!(a.Attachment instanceof Uint8Array))
      throw new FatturaPAModelError(`${ap}.Attachment`, 'must be a Uint8Array');
    w.open('Allegati');
    w.leaf('NomeAttachment', f.text(`${ap}.NomeAttachment`, a.NomeAttachment, 60, 'latin'));
    opt(a.AlgoritmoCompressione, (v) =>
      w.leaf('AlgoritmoCompressione', f.text(`${ap}.AlgoritmoCompressione`, v, 10, 'basic')),
    );
    opt(a.FormatoAttachment, (v) =>
      w.leaf('FormatoAttachment', f.text(`${ap}.FormatoAttachment`, v, 10, 'basic')),
    );
    opt(a.DescrizioneAttachment, (v) =>
      w.leaf('DescrizioneAttachment', f.text(`${ap}.DescrizioneAttachment`, v, 100, 'latin')),
    );
    w.leaf('Attachment', Buffer.from(a.Attachment).toString('base64'));
    w.close('Allegati');
  });

  w.close('FatturaElettronicaBody');
}
