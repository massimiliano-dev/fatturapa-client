/**
 * Typed model of the FatturaPA ordinary invoice ("fattura ordinaria", formats FPA12 and FPR12), schema
 * 1.2.3. Property names are the XSD element names, so the official "rappresentazione tabellare" and the
 * Allegato A field numbers (e.g. 2.2.1.11 PrezzoTotale) apply directly. Element order is handled by the
 * builder, not by the object.
 *
 * Numbers are {@link Num}: a decimal string (`"22.00"`), a JS number, or a {@link Decimal}. The builder
 * formats them to the precision required by the XSD; the parser always returns strings.
 */
import type { Decimal } from './decimal.js';
import type {
  CondizioniPagamento,
  EsigibilitaIVA,
  FormatoTrasmissione,
  ModalitaPagamento,
  Natura,
  RegimeFiscale,
  SocioUnico,
  SoggettoEmittente,
  StatoLiquidazione,
  TipoCassa,
  TipoCessionePrestazione,
  TipoDocumento,
  TipoRitenuta,
  TipoScontoMaggiorazione,
} from './codes.js';

/** A decimal value: `"12.50"`, `12.5` or a `Decimal`. */
export type Num = string | number | Decimal;

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** 1.1.1 / 1.2.1.1 IdFiscaleIVA: country code (ISO 3166-1 alpha-2) and fiscal identifier. */
export interface IdFiscale {
  IdPaese: string;
  IdCodice: string;
}

/** AnagraficaType: either Denominazione (company) or Nome + Cognome (natural person). */
export type Anagrafica = (
  | { Denominazione: string; Nome?: undefined; Cognome?: undefined }
  | { Denominazione?: undefined; Nome: string; Cognome: string }
) & {
  Titolo?: string;
  CodEORI?: string;
};

/** IndirizzoType (1.2.2 Sede, 1.4.2 Sede, StabileOrganizzazione, IndirizzoResa). */
export interface Indirizzo {
  Indirizzo: string;
  NumeroCivico?: string;
  CAP: string;
  Comune: string;
  Provincia?: string;
  Nazione: string;
}

/** 1.1 DatiTrasmissione. */
export interface DatiTrasmissione {
  IdTrasmittente: IdFiscale;
  /** Up to 10 ASCII characters, chosen by the transmitter to identify the file. */
  ProgressivoInvio: string;
  /** Optional in the model: inferred from the root `versione` when omitted. */
  FormatoTrasmissione?: FormatoTrasmissione;
  /** 6 characters (IPA office code) for FPA12, 7 for FPR12; `0000000` if unknown or PEC; `XXXXXXX` abroad. */
  CodiceDestinatario: string;
  ContattiTrasmittente?: { Telefono?: string; Email?: string };
  PECDestinatario?: string;
}

/** 1.2.4 IscrizioneREA. */
export interface IscrizioneREA {
  Ufficio: string;
  NumeroREA: string;
  CapitaleSociale?: Num;
  SocioUnico?: SocioUnico;
  StatoLiquidazione: StatoLiquidazione;
}

/** 1.2 CedentePrestatore (seller / supplier). */
export interface CedentePrestatore {
  DatiAnagrafici: {
    IdFiscaleIVA: IdFiscale;
    CodiceFiscale?: string;
    Anagrafica: Anagrafica;
    AlboProfessionale?: string;
    ProvinciaAlbo?: string;
    NumeroIscrizioneAlbo?: string;
    DataIscrizioneAlbo?: IsoDate;
    RegimeFiscale: RegimeFiscale;
  };
  Sede: Indirizzo;
  StabileOrganizzazione?: Indirizzo;
  IscrizioneREA?: IscrizioneREA;
  Contatti?: { Telefono?: string; Fax?: string; Email?: string };
  RiferimentoAmministrazione?: string;
}

/** 1.3 RappresentanteFiscale (of the seller). */
export interface RappresentanteFiscale {
  DatiAnagrafici: { IdFiscaleIVA: IdFiscale; CodiceFiscale?: string; Anagrafica: Anagrafica };
}

/** 1.4 CessionarioCommittente (buyer / customer). At least one of IdFiscaleIVA and CodiceFiscale (00417). */
export interface CessionarioCommittente {
  DatiAnagrafici: { IdFiscaleIVA?: IdFiscale; CodiceFiscale?: string; Anagrafica: Anagrafica };
  Sede: Indirizzo;
  StabileOrganizzazione?: Indirizzo;
  /** 1.4.4 RappresentanteFiscale of the buyer: IdFiscaleIVA plus Denominazione or Nome + Cognome. */
  RappresentanteFiscale?: {
    IdFiscaleIVA: IdFiscale;
    Denominazione?: string;
    Nome?: string;
    Cognome?: string;
  };
}

/** 1.5 TerzoIntermediarioOSoggettoEmittente. */
export interface TerzoIntermediarioOSoggettoEmittente {
  DatiAnagrafici: { IdFiscaleIVA?: IdFiscale; CodiceFiscale?: string; Anagrafica: Anagrafica };
}

/** 1 FatturaElettronicaHeader. */
export interface FatturaElettronicaHeader {
  DatiTrasmissione: DatiTrasmissione;
  CedentePrestatore: CedentePrestatore;
  RappresentanteFiscale?: RappresentanteFiscale;
  CessionarioCommittente: CessionarioCommittente;
  TerzoIntermediarioOSoggettoEmittente?: TerzoIntermediarioOSoggettoEmittente;
  SoggettoEmittente?: SoggettoEmittente;
}

/** 2.1.1.5 DatiRitenuta (withholding tax). */
export interface DatiRitenuta {
  TipoRitenuta: TipoRitenuta;
  ImportoRitenuta: Num;
  AliquotaRitenuta: Num;
  CausalePagamento: string;
}

/** 2.1.1.7 DatiCassaPrevidenziale (professional pension fund contribution). */
export interface DatiCassaPrevidenziale {
  TipoCassa: TipoCassa;
  AlCassa: Num;
  ImportoContributoCassa: Num;
  ImponibileCassa?: Num;
  AliquotaIVA: Num;
  Ritenuta?: 'SI';
  Natura?: Natura;
  RiferimentoAmministrazione?: string;
}

/** ScontoMaggiorazione (discount `SC` or surcharge `MG`): Percentuale and/or Importo (00437, 00438). */
export interface ScontoMaggiorazione {
  Tipo: TipoScontoMaggiorazione;
  Percentuale?: Num;
  Importo?: Num;
}

/** 2.1.1 DatiGeneraliDocumento. */
export interface DatiGeneraliDocumento {
  TipoDocumento: TipoDocumento;
  /** ISO 4217 currency, e.g. `EUR`. */
  Divisa: string;
  Data: IsoDate;
  /** Must contain at least one digit (00425). */
  Numero: string;
  DatiRitenuta?: DatiRitenuta[];
  /** 2.1.1.6 DatiBollo: virtual stamp duty. */
  DatiBollo?: { BolloVirtuale: 'SI'; ImportoBollo?: Num };
  DatiCassaPrevidenziale?: DatiCassaPrevidenziale[];
  ScontoMaggiorazione?: ScontoMaggiorazione[];
  ImportoTotaleDocumento?: Num;
  Arrotondamento?: Num;
  /** Each item at most 200 Latin-1 characters; longer texts must be split. */
  Causale?: string[];
  Art73?: 'SI';
}

/** DatiDocumentiCorrelatiType (2.1.2 to 2.1.6: order, contract, agreement, receipt, linked invoices). */
export interface DatiDocumentoCorrelato {
  RiferimentoNumeroLinea?: number[];
  IdDocumento: string;
  Data?: IsoDate;
  NumItem?: string;
  CodiceCommessaConvenzione?: string;
  CodiceCUP?: string;
  CodiceCIG?: string;
}

/** 2.1.8 DatiDDT (transport document). */
export interface DatiDDT {
  NumeroDDT: string;
  DataDDT: IsoDate;
  RiferimentoNumeroLinea?: number[];
}

/** 2.1.9 DatiTrasporto. */
export interface DatiTrasporto {
  DatiAnagraficiVettore?: {
    IdFiscaleIVA: IdFiscale;
    CodiceFiscale?: string;
    Anagrafica: Anagrafica;
    NumeroLicenzaGuida?: string;
  };
  MezzoTrasporto?: string;
  CausaleTrasporto?: string;
  NumeroColli?: number;
  Descrizione?: string;
  UnitaMisuraPeso?: string;
  PesoLordo?: Num;
  PesoNetto?: Num;
  /** `YYYY-MM-DDThh:mm:ss` (xs:dateTime). */
  DataOraRitiro?: string;
  DataInizioTrasporto?: IsoDate;
  TipoResa?: string;
  IndirizzoResa?: Indirizzo;
  DataOraConsegna?: string;
}

/** 2.1 DatiGenerali. */
export interface DatiGenerali {
  DatiGeneraliDocumento: DatiGeneraliDocumento;
  DatiOrdineAcquisto?: DatiDocumentoCorrelato[];
  DatiContratto?: DatiDocumentoCorrelato[];
  DatiConvenzione?: DatiDocumentoCorrelato[];
  DatiRicezione?: DatiDocumentoCorrelato[];
  DatiFattureCollegate?: DatiDocumentoCorrelato[];
  DatiSAL?: { RiferimentoFase: number }[];
  DatiDDT?: DatiDDT[];
  DatiTrasporto?: DatiTrasporto;
  FatturaPrincipale?: { NumeroFatturaPrincipale: string; DataFatturaPrincipale: IsoDate };
}

/** 2.2.1.16 AltriDatiGestionali (free management data, e.g. `TipoDato: "ESENZSPORT"` from 1.9.1). */
export interface AltriDatiGestionali {
  TipoDato: string;
  RiferimentoTesto?: string;
  RiferimentoNumero?: Num;
  RiferimentoData?: IsoDate;
}

/** 2.2.1 DettaglioLinee (invoice line). */
export interface DettaglioLinee {
  /** 1..9999. Assigned by {@link computeTotals} when omitted. */
  NumeroLinea?: number;
  TipoCessionePrestazione?: TipoCessionePrestazione;
  CodiceArticolo?: { CodiceTipo: string; CodiceValore: string }[];
  Descrizione: string;
  Quantita?: Num;
  UnitaMisura?: string;
  DataInizioPeriodo?: IsoDate;
  DataFinePeriodo?: IsoDate;
  PrezzoUnitario: Num;
  ScontoMaggiorazione?: ScontoMaggiorazione[];
  /** (PrezzoUnitario ± ScontoMaggiorazione) × Quantita (00423). Computed by {@link computeTotals} when omitted. */
  PrezzoTotale?: Num;
  /** VAT rate as a percentage: `22.00`, not `0.22` (00424). `0` requires Natura (00400). */
  AliquotaIVA: Num;
  Ritenuta?: 'SI';
  Natura?: Natura;
  RiferimentoAmministrazione?: string;
  AltriDatiGestionali?: AltriDatiGestionali[];
}

/** 2.2.2 DatiRiepilogo (VAT summary, one per distinct rate/nature). */
export interface DatiRiepilogo {
  AliquotaIVA: Num;
  Natura?: Natura;
  SpeseAccessorie?: Num;
  Arrotondamento?: Num;
  ImponibileImporto: Num;
  Imposta: Num;
  EsigibilitaIVA?: EsigibilitaIVA;
  /** Required by the specifications when Natura is present (legal reference for the exemption). */
  RiferimentoNormativo?: string;
}

/** 2.4.2 DettaglioPagamento. */
export interface DettaglioPagamento {
  Beneficiario?: string;
  ModalitaPagamento: ModalitaPagamento;
  DataRiferimentoTerminiPagamento?: IsoDate;
  GiorniTerminiPagamento?: number;
  DataScadenzaPagamento?: IsoDate;
  ImportoPagamento: Num;
  CodUfficioPostale?: string;
  CognomeQuietanzante?: string;
  NomeQuietanzante?: string;
  CFQuietanzante?: string;
  TitoloQuietanzante?: string;
  IstitutoFinanziario?: string;
  IBAN?: string;
  ABI?: string;
  CAB?: string;
  BIC?: string;
  ScontoPagamentoAnticipato?: Num;
  DataLimitePagamentoAnticipato?: IsoDate;
  PenalitaPagamentiRitardati?: Num;
  DataDecorrenzaPenale?: IsoDate;
  CodicePagamento?: string;
}

/** 2.4 DatiPagamento. */
export interface DatiPagamento {
  CondizioniPagamento: CondizioniPagamento;
  DettaglioPagamento: DettaglioPagamento[];
}

/** 2.5 Allegati (attachment). `Attachment` holds the raw bytes; the builder base64-encodes them. */
export interface Allegato {
  NomeAttachment: string;
  AlgoritmoCompressione?: string;
  FormatoAttachment?: string;
  DescrizioneAttachment?: string;
  Attachment: Uint8Array;
}

/** 2 FatturaElettronicaBody: one invoice. A file may contain a batch ("lotto") of bodies. */
export interface FatturaElettronicaBody {
  DatiGenerali: DatiGenerali;
  DatiBeniServizi: {
    DettaglioLinee: DettaglioLinee[];
    /** Computed by {@link computeTotals} when omitted. */
    DatiRiepilogo?: DatiRiepilogo[];
  };
  DatiVeicoli?: { Data: IsoDate; TotalePercorso: string };
  DatiPagamento?: DatiPagamento[];
  Allegati?: Allegato[];
}

/** The root element `FatturaElettronica`. */
export interface FatturaElettronica {
  /** `FPR12` (to businesses and consumers) or `FPA12` (to public administrations). */
  versione: FormatoTrasmissione;
  /** Optional attribute identifying the software that produced the file (max 10 ASCII characters). */
  SistemaEmittente?: string;
  FatturaElettronicaHeader: FatturaElettronicaHeader;
  FatturaElettronicaBody: FatturaElettronicaBody[];
}

/** Namespace of the ordinary invoice, schema 1.2.x. */
export const FATTURAPA_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';
/** Namespace of the XML signature (XAdES enveloped signature). */
export const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
