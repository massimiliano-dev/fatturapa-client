/**
 * Code tables of the FatturaPA format, GENERATED from the official XSD "Schema_VFPR12_v1.2.3.xsd"
 * (Agenzia delle Entrate, schema 1.2.3, specifiche tecniche 1.9.1 usable from 15 May 2026;
 * SHA-256 152944f6eef9f5d69ef6e955ee173b32142b00a8c1c5222fc97dfab5910e8a8c).
 *
 * Descriptions are copied verbatim from the XSD annotations. Do not edit by hand: the validator test
 * `official-xsd.test.ts` checks that every table still matches the pinned schema.
 */


/** 1.1.3 FormatoTrasmissione. */
export const FORMATO_TRASMISSIONE = {
  "FPA12": "Fattura verso PA",
  "FPR12": "Fattura verso privati",
} as const;
/** A valid FormatoTrasmissione code. */
export type FormatoTrasmissione = keyof typeof FORMATO_TRASMISSIONE;

/** 2.1.1.1 TipoDocumento. */
export const TIPO_DOCUMENTO = {
  "TD01": "Fattura",
  "TD02": "Acconto / anticipo su fattura",
  "TD03": "Acconto / anticipo su parcella",
  "TD04": "Nota di credito",
  "TD05": "Nota di debito",
  "TD06": "Parcella",
  "TD16": "Integrazione fattura reverse charge interno",
  "TD17": "Integrazione/autofattura per acquisto servizi dall'estero",
  "TD18": "Integrazione per acquisto di beni intracomunitari",
  "TD19": "Integrazione/autofattura per acquisto di beni ex art.17 c.2 DPR 633/72",
  "TD20": "Autofattura per regolarizzazione e integrazione delle fatture (ex art. 6 c.9-bis d.lgs. 471/97 o art.46 c.5 D.L. 331/93)",
  "TD21": "Autofattura per splafonamento",
  "TD22": "Estrazione benida Deposito IVA",
  "TD23": "Estrazione beni da Deposito IVA con versamento dell'IVA",
  "TD24": "Fattura differita di cui all'art.21, comma 4, terzo periodo lett. a) DPR 633/72",
  "TD25": "Fattura differita di cui all'art.21, comma 4, terzo periodo lett. b) DPR 633/72",
  "TD26": "Cessione di beni ammortizzabili e per passaggi interni (ex art.36 DPR 633/72)",
  "TD27": "Fattura per autoconsumo o per cessioni gratuite senza rivalsa",
  "TD28": "Acquisti da San Marino con IVA (fattura cartacea)",
  "TD29": "Comunicazione per omessa o irregolare fatturazione da parte del cedente/prestatore italiano (art. 6, comma 8, D.Lgs. 471/97)",
} as const;
/** A valid TipoDocumento code. */
export type TipoDocumento = keyof typeof TIPO_DOCUMENTO;

/** 1.2.1.8 RegimeFiscale. */
export const REGIME_FISCALE = {
  "RF01": "Regime ordinario",
  "RF02": "Regime dei contribuenti minimi (art. 1,c.96-117, L. 244/2007)",
  "RF04": "Agricoltura e attivit\u00e0 connesse e pesca (artt. 34 e 34-bis, D.P.R. 633/1972)",
  "RF05": "Vendita sali e tabacchi (art. 74, c.1, D.P.R. 633/1972)",
  "RF06": "Commercio dei fiammiferi (art. 74, c.1, D.P.R. 633/1972)",
  "RF07": "Editoria (art. 74, c.1, D.P.R. 633/1972)",
  "RF08": "Gestione di servizi di telefonia pubblica (art. 74, c.1, D.P.R. 633/1972)",
  "RF09": "Rivendita di documenti di trasporto pubblico e di sosta (art. 74, c.1, D.P.R. 633/1972)",
  "RF10": "Intrattenimenti, giochi e altre attivit\u00e0 di cui alla tariffa allegata al D.P.R. 640/72 (art. 74, c.6, D.P.R. 633/1972)",
  "RF11": "Agenzie di viaggi e turismo (art. 74-ter, D.P.R. 633/1972)",
  "RF12": "Agriturismo (art. 5, c.2, L. 413/1991)",
  "RF13": "Vendite a domicilio (art. 25-bis, c.6, D.P.R. 600/1973)",
  "RF14": "Rivendita di beni usati, di oggetti d\u2019arte, d\u2019antiquariato o da collezione (art. 36, D.L. 41/1995)",
  "RF15": "Agenzie di vendite all\u2019asta di oggetti d\u2019arte, antiquariato o da collezione (art. 40-bis, D.L. 41/1995)",
  "RF16": "IVA per cassa P.A. (art. 6, c.5, D.P.R. 633/1972)",
  "RF17": "IVA per cassa (art. 32-bis, D.L. 83/2012)",
  "RF18": "Altro",
  "RF19": "Regime forfettario",
  "RF20": "Regime transfrontaliero di Franchigia IVA (Direttiva UE 2020/285)",
} as const;
/** A valid RegimeFiscale code. */
export type RegimeFiscale = keyof typeof REGIME_FISCALE;

/** 2.2.1.14 / 2.2.2.2 Natura. */
export const NATURA = {
  "N1": "Escluse ex. art. 15 del D.P.R. 633/1972",
  "N2": "Non soggette",
  "N2.1": "Non soggette ad IVA ai sensi degli artt. da 7 a 7-septies del DPR 633/72",
  "N2.2": "Non soggette - altri casi",
  "N3": "Non imponibili",
  "N3.1": "Non Imponibili - esportazioni",
  "N3.2": "Non Imponibili - cessioni intracomunitarie",
  "N3.3": "Non Imponibili - cessioni verso San Marino",
  "N3.4": "Non Imponibili - operazioni assimilate alle cessioni all'esportazione",
  "N3.5": "Non Imponibili - a seguito di dichiarazioni d'intento",
  "N3.6": "Non Imponibili - altre operazioni che non concorrono alla formazione del plafond",
  "N4": "Esenti",
  "N5": "Regime del margine/IVA non esposta in fattura",
  "N6": "Inversione contabile (per le operazioni in reverse charge ovvero nei casi di autofatturazione per acquisti extra UE di servizi ovvero per importazioni di beni nei soli casi previsti)",
  "N6.1": "Inversione contabile - cessione di rottami e altri materiali di recupero",
  "N6.2": "Inversione contabile - cessione di oro e argento ai sensi della legge 7/2000 nonch\u00e9 di oreficeria usata ad OPO",
  "N6.3": "Inversione contabile - subappalto nel settore edile",
  "N6.4": "Inversione contabile - cessione di fabbricati",
  "N6.5": "Inversione contabile - cessione di telefoni cellulari",
  "N6.6": "Inversione contabile - cessione di prodotti elettronici",
  "N6.7": "Inversione contabile - prestazioni comparto edile e settori connessi",
  "N6.8": "Inversione contabile - operazioni settore energetico",
  "N6.9": "Inversione contabile - altri casi",
  "N7": "IVA assolta in altro stato UE (prestazione di servizi di telecomunicazioni, tele-radiodiffusione ed elettronici ex art. 7-octies lett. a, b, art. 74-sexies DPR 633/72)",
} as const;
/** A valid Natura code. */
export type Natura = keyof typeof NATURA;

/** 2.4.2.2 ModalitaPagamento. */
export const MODALITA_PAGAMENTO = {
  "MP01": "contanti",
  "MP02": "assegno",
  "MP03": "assegno circolare",
  "MP04": "contanti presso Tesoreria",
  "MP05": "bonifico",
  "MP06": "vaglia cambiario",
  "MP07": "bollettino bancario",
  "MP08": "carta di pagamento",
  "MP09": "RID",
  "MP10": "RID utenze",
  "MP11": "RID veloce",
  "MP12": "RIBA",
  "MP13": "MAV",
  "MP14": "quietanza erario",
  "MP15": "giroconto su conti di contabilit\u00e0 speciale",
  "MP16": "domiciliazione bancaria",
  "MP17": "domiciliazione postale",
  "MP18": "bollettino di c/c postale",
  "MP19": "SEPA Direct Debit",
  "MP20": "SEPA Direct Debit CORE",
  "MP21": "SEPA Direct Debit B2B",
  "MP22": "Trattenuta su somme gi\u00e0 riscosse",
  "MP23": "PagoPA",
} as const;
/** A valid ModalitaPagamento code. */
export type ModalitaPagamento = keyof typeof MODALITA_PAGAMENTO;

/** 2.4.1 CondizioniPagamento. */
export const CONDIZIONI_PAGAMENTO = {
  "TP01": "pagamento a rate",
  "TP02": "pagamento completo",
  "TP03": "anticipo",
} as const;
/** A valid CondizioniPagamento code. */
export type CondizioniPagamento = keyof typeof CONDIZIONI_PAGAMENTO;

/** 2.1.1.5.1 TipoRitenuta. */
export const TIPO_RITENUTA = {
  "RT01": "Ritenuta di acconto persone fisiche",
  "RT02": "Ritenuta di acconto persone giuridiche",
  "RT03": "Contributo INPS",
  "RT04": "Contributo ENASARCO",
  "RT05": "Contributo ENPAM",
  "RT06": "Altro contributo previdenziale",
} as const;
/** A valid TipoRitenuta code. */
export type TipoRitenuta = keyof typeof TIPO_RITENUTA;

/** 2.1.1.5.4 CausalePagamento (codes of the CU form instructions). */
export const CAUSALE_PAGAMENTO = {
  "A": "",
  "B": "",
  "C": "",
  "D": "",
  "E": "",
  "G": "",
  "H": "",
  "I": "",
  "L": "",
  "M": "",
  "N": "",
  "O": "",
  "P": "",
  "Q": "",
  "R": "",
  "S": "",
  "T": "",
  "U": "",
  "V": "",
  "W": "",
  "X": "",
  "Y": "",
  "Z": "",
  "L1": "",
  "M1": "",
  "M2": "",
  "O1": "",
  "V1": "",
  "ZO": "",
} as const;
/** A valid CausalePagamento code. */
export type CausalePagamento = keyof typeof CAUSALE_PAGAMENTO;

/** 2.1.1.7.1 TipoCassa. */
export const TIPO_CASSA = {
  "TC01": "Cassa nazionale previdenza e assistenza avvocati e procuratori legali",
  "TC02": "Cassa previdenza dottori commercialisti",
  "TC03": "Cassa previdenza e assistenza geometri",
  "TC04": "Cassa nazionale previdenza e assistenza ingegneri e architetti liberi professionisti",
  "TC05": "Cassa nazionale del notariato",
  "TC06": "Cassa nazionale previdenza e assistenza ragionieri e periti commerciali",
  "TC07": "Ente nazionale assistenza agenti e rappresentanti di commercio (ENASARCO)",
  "TC08": "Ente nazionale previdenza e assistenza consulenti del lavoro (ENPACL)",
  "TC09": "Ente nazionale previdenza e assistenza medici (ENPAM)",
  "TC10": "Ente nazionale previdenza e assistenza farmacisti (ENPAF)",
  "TC11": "Ente nazionale previdenza e assistenza veterinari (ENPAV)",
  "TC12": "Ente nazionale previdenza e assistenza impiegati dell'agricoltura (ENPAIA)",
  "TC13": "Fondo previdenza impiegati imprese di spedizione e agenzie marittime",
  "TC14": "Istituto nazionale previdenza giornalisti italiani (INPGI)",
  "TC15": "Opera nazionale assistenza orfani sanitari italiani (ONAOSI)",
  "TC16": "Cassa autonoma assistenza integrativa giornalisti italiani (CASAGIT)",
  "TC17": "Ente previdenza periti industriali e periti industriali laureati (EPPI)",
  "TC18": "Ente previdenza e assistenza pluricategoriale (EPAP)",
  "TC19": "Ente nazionale previdenza e assistenza biologi (ENPAB)",
  "TC20": "Ente nazionale previdenza e assistenza professione infermieristica (ENPAPI)",
  "TC21": "Ente nazionale previdenza e assistenza psicologi (ENPAP)",
  "TC22": "INPS",
} as const;
/** A valid TipoCassa code. */
export type TipoCassa = keyof typeof TIPO_CASSA;

/** 2.2.2.7 EsigibilitaIVA. */
export const ESIGIBILITA_IVA = {
  "D": "esigibilit\u00e0 differita",
  "I": "esigibilit\u00e0 immediata",
  "S": "scissione dei pagamenti",
} as const;
/** A valid EsigibilitaIVA code. */
export type EsigibilitaIVA = keyof typeof ESIGIBILITA_IVA;

/** ScontoMaggiorazione/Tipo. */
export const TIPO_SCONTO_MAGGIORAZIONE = {
  "SC": "SC = Sconto",
  "MG": "MG = Maggiorazione",
} as const;
/** A valid TipoScontoMaggiorazione code. */
export type TipoScontoMaggiorazione = keyof typeof TIPO_SCONTO_MAGGIORAZIONE;

/** 2.2.1.2 TipoCessionePrestazione. */
export const TIPO_CESSIONE_PRESTAZIONE = {
  "SC": "Sconto",
  "PR": "Premio",
  "AB": "Abbuono",
  "AC": "Spesa accessoria",
} as const;
/** A valid TipoCessionePrestazione code. */
export type TipoCessionePrestazione = keyof typeof TIPO_CESSIONE_PRESTAZIONE;

/** 1.6 SoggettoEmittente. */
export const SOGGETTO_EMITTENTE = {
  "CC": "Cessionario / Committente",
  "TZ": "Terzo",
} as const;
/** A valid SoggettoEmittente code. */
export type SoggettoEmittente = keyof typeof SOGGETTO_EMITTENTE;

/** 1.2.4.4 SocioUnico. */
export const SOCIO_UNICO = {
  "SU": "socio unico",
  "SM": "pi\u00f9 soci",
} as const;
/** A valid SocioUnico code. */
export type SocioUnico = keyof typeof SOCIO_UNICO;

/** 1.2.4.5 StatoLiquidazione. */
export const STATO_LIQUIDAZIONE = {
  "LS": "in liquidazione",
  "LN": "non in liquidazione",
} as const;
/** A valid StatoLiquidazione code. */
export type StatoLiquidazione = keyof typeof STATO_LIQUIDAZIONE;

/** Checks membership in a code table without widening the type. */
export function isCode<T extends Record<string, string>>(table: T, value: unknown): value is keyof T & string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);
}

/** XSD simple type names, used by the validator test to compare with the official schema. */
export const XSD_CODE_TABLES = {
  FormatoTrasmissioneType: FORMATO_TRASMISSIONE,
  TipoDocumentoType: TIPO_DOCUMENTO,
  RegimeFiscaleType: REGIME_FISCALE,
  NaturaType: NATURA,
  ModalitaPagamentoType: MODALITA_PAGAMENTO,
  CondizioniPagamentoType: CONDIZIONI_PAGAMENTO,
  TipoRitenutaType: TIPO_RITENUTA,
  CausalePagamentoType: CAUSALE_PAGAMENTO,
  TipoCassaType: TIPO_CASSA,
  EsigibilitaIVAType: ESIGIBILITA_IVA,
  TipoScontoMaggiorazioneType: TIPO_SCONTO_MAGGIORAZIONE,
  TipoCessionePrestazioneType: TIPO_CESSIONE_PRESTAZIONE,
  SoggettoEmittenteType: SOGGETTO_EMITTENTE,
  SocioUnicoType: SOCIO_UNICO,
  StatoLiquidazioneType: STATO_LIQUIDAZIONE,
} as const;
