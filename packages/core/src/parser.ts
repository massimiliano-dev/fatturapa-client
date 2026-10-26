import { FatturaPAParseError } from './errors.js';
import type { FatturaElettronica } from './model.js';
import { FATTURAPA_NAMESPACE } from './model.js';
import type { SafeXmlOptions } from './safe-xml.js';
import { attribute, children, parseXmlDocument, textOf, type XmlNode } from './xml.js';

/** How a child element is read: text, integer, base64 bytes, or a nested complex type. */
type Kind = 'text' | 'int' | 'bytes' | { type: string };
/** [kind, repeated] */
type ChildSpec = readonly [Kind, boolean?];

const T: ChildSpec = ['text'];
const TS: ChildSpec = ['text', true];
const I: ChildSpec = ['int'];
const IS: ChildSpec = ['int', true];
const c = (type: string, repeated = false): ChildSpec => [{ type }, repeated];

/**
 * Structure of the ordinary invoice, schema 1.2.3, as needed by the reader: which children exist, which
 * repeat, which are integers or base64. Element order is not enforced here: XSD validation does that.
 */
const SPEC: Record<string, Record<string, ChildSpec>> = {
  FatturaElettronicaHeader: {
    DatiTrasmissione: c('DatiTrasmissione'),
    CedentePrestatore: c('CedentePrestatore'),
    RappresentanteFiscale: c('RappresentanteFiscale'),
    CessionarioCommittente: c('CessionarioCommittente'),
    TerzoIntermediarioOSoggettoEmittente: c('TerzoIntermediario'),
    SoggettoEmittente: T,
  },
  IdFiscale: { IdPaese: T, IdCodice: T },
  DatiTrasmissione: {
    IdTrasmittente: c('IdFiscale'),
    ProgressivoInvio: T,
    FormatoTrasmissione: T,
    CodiceDestinatario: T,
    ContattiTrasmittente: c('ContattiTrasmittente'),
    PECDestinatario: T,
  },
  ContattiTrasmittente: { Telefono: T, Email: T },
  Contatti: { Telefono: T, Fax: T, Email: T },
  Anagrafica: { Denominazione: T, Nome: T, Cognome: T, Titolo: T, CodEORI: T },
  Indirizzo: { Indirizzo: T, NumeroCivico: T, CAP: T, Comune: T, Provincia: T, Nazione: T },
  CedentePrestatore: {
    DatiAnagrafici: c('DatiAnagraficiCedente'),
    Sede: c('Indirizzo'),
    StabileOrganizzazione: c('Indirizzo'),
    IscrizioneREA: c('IscrizioneREA'),
    Contatti: c('Contatti'),
    RiferimentoAmministrazione: T,
  },
  DatiAnagraficiCedente: {
    IdFiscaleIVA: c('IdFiscale'),
    CodiceFiscale: T,
    Anagrafica: c('Anagrafica'),
    AlboProfessionale: T,
    ProvinciaAlbo: T,
    NumeroIscrizioneAlbo: T,
    DataIscrizioneAlbo: T,
    RegimeFiscale: T,
  },
  IscrizioneREA: { Ufficio: T, NumeroREA: T, CapitaleSociale: T, SocioUnico: T, StatoLiquidazione: T },
  RappresentanteFiscale: { DatiAnagrafici: c('DatiAnagraficiBase') },
  DatiAnagraficiBase: { IdFiscaleIVA: c('IdFiscale'), CodiceFiscale: T, Anagrafica: c('Anagrafica') },
  TerzoIntermediario: { DatiAnagrafici: c('DatiAnagraficiBase') },
  CessionarioCommittente: {
    DatiAnagrafici: c('DatiAnagraficiBase'),
    Sede: c('Indirizzo'),
    StabileOrganizzazione: c('Indirizzo'),
    RappresentanteFiscale: c('RappresentanteFiscaleCessionario'),
  },
  RappresentanteFiscaleCessionario: { IdFiscaleIVA: c('IdFiscale'), Denominazione: T, Nome: T, Cognome: T },
  FatturaElettronicaBody: {
    DatiGenerali: c('DatiGenerali'),
    DatiBeniServizi: c('DatiBeniServizi'),
    DatiVeicoli: c('DatiVeicoli'),
    DatiPagamento: c('DatiPagamento', true),
    Allegati: c('Allegati', true),
  },
  DatiGenerali: {
    DatiGeneraliDocumento: c('DatiGeneraliDocumento'),
    DatiOrdineAcquisto: c('DocumentoCorrelato', true),
    DatiContratto: c('DocumentoCorrelato', true),
    DatiConvenzione: c('DocumentoCorrelato', true),
    DatiRicezione: c('DocumentoCorrelato', true),
    DatiFattureCollegate: c('DocumentoCorrelato', true),
    DatiSAL: c('DatiSAL', true),
    DatiDDT: c('DatiDDT', true),
    DatiTrasporto: c('DatiTrasporto'),
    FatturaPrincipale: c('FatturaPrincipale'),
  },
  DatiGeneraliDocumento: {
    TipoDocumento: T,
    Divisa: T,
    Data: T,
    Numero: T,
    DatiRitenuta: c('DatiRitenuta', true),
    DatiBollo: c('DatiBollo'),
    DatiCassaPrevidenziale: c('DatiCassaPrevidenziale', true),
    ScontoMaggiorazione: c('ScontoMaggiorazione', true),
    ImportoTotaleDocumento: T,
    Arrotondamento: T,
    Causale: TS,
    Art73: T,
  },
  DatiRitenuta: { TipoRitenuta: T, ImportoRitenuta: T, AliquotaRitenuta: T, CausalePagamento: T },
  DatiBollo: { BolloVirtuale: T, ImportoBollo: T },
  DatiCassaPrevidenziale: {
    TipoCassa: T,
    AlCassa: T,
    ImportoContributoCassa: T,
    ImponibileCassa: T,
    AliquotaIVA: T,
    Ritenuta: T,
    Natura: T,
    RiferimentoAmministrazione: T,
  },
  ScontoMaggiorazione: { Tipo: T, Percentuale: T, Importo: T },
  DocumentoCorrelato: {
    RiferimentoNumeroLinea: IS,
    IdDocumento: T,
    Data: T,
    NumItem: T,
    CodiceCommessaConvenzione: T,
    CodiceCUP: T,
    CodiceCIG: T,
  },
  DatiSAL: { RiferimentoFase: I },
  DatiDDT: { NumeroDDT: T, DataDDT: T, RiferimentoNumeroLinea: IS },
  DatiTrasporto: {
    DatiAnagraficiVettore: c('DatiAnagraficiVettore'),
    MezzoTrasporto: T,
    CausaleTrasporto: T,
    NumeroColli: I,
    Descrizione: T,
    UnitaMisuraPeso: T,
    PesoLordo: T,
    PesoNetto: T,
    DataOraRitiro: T,
    DataInizioTrasporto: T,
    TipoResa: T,
    IndirizzoResa: c('Indirizzo'),
    DataOraConsegna: T,
  },
  DatiAnagraficiVettore: {
    IdFiscaleIVA: c('IdFiscale'),
    CodiceFiscale: T,
    Anagrafica: c('Anagrafica'),
    NumeroLicenzaGuida: T,
  },
  FatturaPrincipale: { NumeroFatturaPrincipale: T, DataFatturaPrincipale: T },
  DatiBeniServizi: { DettaglioLinee: c('DettaglioLinee', true), DatiRiepilogo: c('DatiRiepilogo', true) },
  DettaglioLinee: {
    NumeroLinea: I,
    TipoCessionePrestazione: T,
    CodiceArticolo: c('CodiceArticolo', true),
    Descrizione: T,
    Quantita: T,
    UnitaMisura: T,
    DataInizioPeriodo: T,
    DataFinePeriodo: T,
    PrezzoUnitario: T,
    ScontoMaggiorazione: c('ScontoMaggiorazione', true),
    PrezzoTotale: T,
    AliquotaIVA: T,
    Ritenuta: T,
    Natura: T,
    RiferimentoAmministrazione: T,
    AltriDatiGestionali: c('AltriDatiGestionali', true),
  },
  CodiceArticolo: { CodiceTipo: T, CodiceValore: T },
  AltriDatiGestionali: { TipoDato: T, RiferimentoTesto: T, RiferimentoNumero: T, RiferimentoData: T },
  DatiRiepilogo: {
    AliquotaIVA: T,
    Natura: T,
    SpeseAccessorie: T,
    Arrotondamento: T,
    ImponibileImporto: T,
    Imposta: T,
    EsigibilitaIVA: T,
    RiferimentoNormativo: T,
  },
  DatiVeicoli: { Data: T, TotalePercorso: T },
  DatiPagamento: { CondizioniPagamento: T, DettaglioPagamento: c('DettaglioPagamento', true) },
  DettaglioPagamento: {
    Beneficiario: T,
    ModalitaPagamento: T,
    DataRiferimentoTerminiPagamento: T,
    GiorniTerminiPagamento: I,
    DataScadenzaPagamento: T,
    ImportoPagamento: T,
    CodUfficioPostale: T,
    CognomeQuietanzante: T,
    NomeQuietanzante: T,
    CFQuietanzante: T,
    TitoloQuietanzante: T,
    IstitutoFinanziario: T,
    IBAN: T,
    ABI: T,
    CAB: T,
    BIC: T,
    ScontoPagamentoAnticipato: T,
    DataLimitePagamentoAnticipato: T,
    PenalitaPagamentiRitardati: T,
    DataDecorrenzaPenale: T,
    CodicePagamento: T,
  },
  Allegati: {
    NomeAttachment: T,
    AlgoritmoCompressione: T,
    FormatoAttachment: T,
    DescrizioneAttachment: T,
    Attachment: ['bytes'],
  },
};

const BASE64 = /^[A-Za-z0-9+/\s]*={0,2}\s*$/;

function readValue(node: XmlNode, kind: Kind, path: string): unknown {
  if (kind === 'text') return textOf(node);
  if (kind === 'int') {
    const text = textOf(node);
    if (!/^[+-]?\d{1,9}$/.test(text)) throw new FatturaPAParseError(`${path} is not an integer`);
    return Number(text);
  }
  if (kind === 'bytes') {
    const text = textOf(node);
    if (!BASE64.test(text)) throw new FatturaPAParseError(`${path} is not base64`);
    return new Uint8Array(Buffer.from(text, 'base64'));
  }
  return readType(node, kind.type, path);
}

function readType(node: XmlNode, type: string, path: string): Record<string, unknown> {
  const spec = SPEC[type];
  if (!spec) throw new Error(`internal: unknown type ${type}`);
  const out: Record<string, unknown> = {};
  for (const [name, [kind, repeated]] of Object.entries(spec)) {
    const items = children(node, name);
    if (items.length === 0) continue;
    if (repeated) {
      out[name] = items.map((item, i) => readValue(item, kind, `${path}.${name}[${i}]`));
    } else {
      if (items.length > 1) throw new FatturaPAParseError(`${path}.${name} occurs more than once`);
      out[name] = readValue(items[0]!, kind, `${path}.${name}`);
    }
  }
  return out;
}

/** Options of {@link parseFatturaXml}. */
export type ParseOptions = SafeXmlOptions;

/**
 * Parses a FatturaPA ordinary invoice (FPR12/FPA12, schema 1.2.x) into the typed model. All values are
 * returned as strings except integers (NumeroLinea, GiorniTerminiPagamento, …) and attachments (bytes).
 *
 * The parser is lenient on structure (element order and required elements are XSD concerns: validate
 * with `@massimiliano-dev/fatturapa-validator` when that matters) but strict on input safety: DOCTYPE and
 * entity declarations are refused, only UTF-8 is accepted and size is capped. An enveloped XAdES
 * signature is ignored, not verified. For CAdES `.p7m` files call {@link extractP7mContent} first.
 *
 * @throws {UnsafeXmlError} if the input is refused before parsing.
 * @throws {FatturaPAParseError} if it is not an ordinary invoice.
 */
export function parseFatturaXml(input: string | Uint8Array, options: ParseOptions = {}): FatturaElettronica {
  const { name, node, namespace } = parseXmlDocument(input, options);
  if (name === 'FatturaElettronicaSemplificata') {
    throw new FatturaPAParseError('Simplified invoices (FSM10) are not supported yet');
  }
  if (name !== 'FatturaElettronica')
    throw new FatturaPAParseError('The document is not a FatturaElettronica');
  const versione = attribute(node, 'versione');
  if (versione !== 'FPR12' && versione !== 'FPA12') {
    throw new FatturaPAParseError('Unsupported FatturaElettronica versione (expected FPR12 or FPA12)');
  }
  if (namespace !== FATTURAPA_NAMESPACE)
    throw new FatturaPAParseError('The document does not use the FatturaPA 1.2 namespace');

  const headers = children(node, 'FatturaElettronicaHeader');
  const bodies = children(node, 'FatturaElettronicaBody');
  if (headers.length !== 1) throw new FatturaPAParseError('Exactly one FatturaElettronicaHeader is required');
  if (bodies.length === 0) throw new FatturaPAParseError('At least one FatturaElettronicaBody is required');

  const sistema = attribute(node, 'SistemaEmittente');
  return {
    versione,
    ...(sistema === undefined ? {} : { SistemaEmittente: sistema }),
    FatturaElettronicaHeader: readType(headers[0]!, 'FatturaElettronicaHeader', 'FatturaElettronicaHeader'),
    FatturaElettronicaBody: bodies.map((b, i) =>
      readType(b, 'FatturaElettronicaBody', `FatturaElettronicaBody[${i}]`),
    ),
  } as unknown as FatturaElettronica;
}
