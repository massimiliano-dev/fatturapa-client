import type { EsitoCommittente } from './provider.js';
import { FatturaPAParseError } from './errors.js';
import type { SafeXmlOptions } from './safe-xml.js';
import { describeSdiError } from './sdi-errors.js';
import { children, parseXmlDocument, textOf, type XmlNode } from './xml.js';

/**
 * Type codes of SDI notifications, as used in their file names:
 * RC ricevuta di consegna, NS notifica/ricevuta di scarto, MC mancata consegna / impossibilità di
 * recapito, NE notifica di esito (PA), DT decorrenza termini (PA), AT attestazione di avvenuta trasmissione
 * con impossibilità di recapito (PA), MT metadati (to the recipient), EC esito committente (sent by the
 * PA), SE scarto esito committente.
 */
export type SdiNotificationType = 'RC' | 'NS' | 'MC' | 'NE' | 'DT' | 'AT' | 'MT' | 'EC' | 'SE';

/** An error listed in a rejection, with the official description when the code is documented. */
export interface SdiNotificationError {
  Codice: string;
  Descrizione: string;
  Suggerimento?: string;
  /** Description from the technical specifications (Allegato A 1.9.1), if the code is known. */
  officialDescription?: string;
}

/** A parsed SDI notification. Fields not present in a given type are undefined. */
export interface SdiNotification {
  type: SdiNotificationType;
  /** Root element name, e.g. `RicevutaConsegna`, `NotificaScarto`, `RicevutaScarto`. */
  rootElement: string;
  /** Namespace family: `pa` (fatturapa.gov.it messaggi v1.x) or `b2b` (ivaservizi messaggi v1.0). */
  family: 'pa' | 'b2b';
  IdentificativoSdI?: string;
  NomeFile?: string;
  Hash?: string;
  DataOraRicezione?: string;
  DataOraConsegna?: string;
  DataMessaADisposizione?: string;
  Destinatario?: { Codice: string; Descrizione?: string };
  RiferimentoArchivio?: { IdentificativoSdI: string; NomeFile: string };
  ListaErrori?: SdiNotificationError[];
  Descrizione?: string;
  MessageId?: string;
  PecMessageId?: string;
  Note?: string;
  /** NE / EC: the PA's outcome. */
  Esito?: EsitoCommittente;
  RiferimentoFattura?: { NumeroFattura: string; AnnoFattura: string; PosizioneFattura?: string };
  /** SE: EN00 non-conforming, EN01 not admissible. */
  Scarto?: string;
  /** MT: recipient code, format and delivery attempts. */
  CodiceDestinatario?: string;
  Formato?: string;
  TentativiInvio?: string;
  HashFileOriginale?: string;
  /** True if the document carries an XML signature element. The signature is NOT verified. */
  signed: boolean;
}

const PA_NAMESPACE = 'http://www.fatturapa.gov.it/sdi/messaggi/v1.0';
const B2B_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fattura/messaggi/v1.0';

const ROOTS: Record<string, SdiNotificationType> = {
  RicevutaConsegna: 'RC',
  NotificaScarto: 'NS',
  RicevutaScarto: 'NS',
  NotificaMancataConsegna: 'MC',
  RicevutaImpossibilitaRecapito: 'MC',
  NotificaEsito: 'NE',
  NotificaDecorrenzaTermini: 'DT',
  AttestazioneTrasmissioneFattura: 'AT',
  MetadatiInvioFile: 'MT',
  FileMetadati: 'MT',
  NotificaEsitoCommittente: 'EC',
  ScartoEsitoCommittente: 'SE',
};

function text(node: XmlNode, name: string): string | undefined {
  const items = children(node, name);
  if (items.length > 1) throw new FatturaPAParseError(`${name} occurs more than once`);
  return items[0] === undefined ? undefined : textOf(items[0]);
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  return children(node, name)[0];
}

/**
 * Parses an SDI notification (RC, NS, MC, NE, DT, AT, MT, EC, SE) in either namespace family: the PA
 * messages (`MessaggiTypes_v1.1.xsd`) and the B2B messages (`MessaggiFatturaTypes_v1.0.xsd`).
 *
 * The SDI signs its notifications (XAdES enveloped). This function does NOT verify the signature: treat
 * the content as authentic only if it reached you over an authenticated channel (your provider's API or
 * a verified webhook).
 *
 * @throws {UnsafeXmlError} if the input is refused before parsing.
 * @throws {FatturaPAParseError} if it is not a known SDI notification.
 */
export function parseSdiNotification(
  input: string | Uint8Array,
  options: SafeXmlOptions = {},
): SdiNotification {
  const { name, node, namespace } = parseXmlDocument(input, { maxBytes: options.maxBytes ?? 1024 * 1024 });
  const type = Object.prototype.hasOwnProperty.call(ROOTS, name) ? ROOTS[name] : undefined;
  if (!type) throw new FatturaPAParseError('The document is not a known SDI notification');
  const family = namespace === PA_NAMESPACE ? 'pa' : namespace === B2B_NAMESPACE ? 'b2b' : undefined;
  if (!family) throw new FatturaPAParseError('The notification does not use a known SDI messages namespace');

  const out: SdiNotification = {
    type,
    rootElement: name,
    family,
    signed: children(node, 'Signature').length > 0,
  };
  const assign = (key: keyof SdiNotification, value: string | undefined) => {
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  };
  for (const key of [
    'IdentificativoSdI',
    'NomeFile',
    'Hash',
    'DataOraRicezione',
    'DataOraConsegna',
    'DataMessaADisposizione',
    'Descrizione',
    'MessageId',
    'PecMessageId',
    'Note',
    'Scarto',
    'CodiceDestinatario',
    'Formato',
    'TentativiInvio',
    'HashFileOriginale',
  ] as const) {
    assign(key, text(node, key));
  }

  const destinatario = child(node, 'Destinatario');
  if (destinatario) {
    out.Destinatario = { Codice: text(destinatario, 'Codice') ?? '' };
    const descr = text(destinatario, 'Descrizione');
    if (descr !== undefined) out.Destinatario.Descrizione = descr;
  }
  const archivio = child(node, 'RiferimentoArchivio');
  if (archivio) {
    out.RiferimentoArchivio = {
      IdentificativoSdI: text(archivio, 'IdentificativoSdI') ?? '',
      NomeFile: text(archivio, 'NomeFile') ?? '',
    };
  }
  const lista = child(node, 'ListaErrori');
  if (lista) {
    out.ListaErrori = children(lista, 'Errore')
      .slice(0, 200)
      .map((e) => {
        const codice = text(e, 'Codice') ?? '';
        const err: SdiNotificationError = { Codice: codice, Descrizione: text(e, 'Descrizione') ?? '' };
        const suggerimento = text(e, 'Suggerimento');
        if (suggerimento !== undefined) err.Suggerimento = suggerimento;
        const official = describeSdiError(codice);
        if (official !== undefined) err.officialDescription = official;
        return err;
      });
  }

  // NE wraps the PA outcome in EsitoCommittente; EC carries it at the root.
  const esitoNode = type === 'NE' ? child(node, 'EsitoCommittente') : type === 'EC' ? node : undefined;
  if (esitoNode) {
    const esito = text(esitoNode, 'Esito');
    if (esito === 'EC01' || esito === 'EC02') out.Esito = esito;
    if (type === 'NE') {
      const descr = text(esitoNode, 'Descrizione');
      if (descr !== undefined && out.Descrizione === undefined) out.Descrizione = descr;
    }
  }
  const rifNode = child(esitoNode ?? node, 'RiferimentoFattura') ?? child(node, 'RiferimentoFattura');
  if (rifNode) {
    out.RiferimentoFattura = {
      NumeroFattura: text(rifNode, 'NumeroFattura') ?? '',
      AnnoFattura: text(rifNode, 'AnnoFattura') ?? '',
    };
    const pos = text(rifNode, 'PosizioneFattura');
    if (pos !== undefined) out.RiferimentoFattura.PosizioneFattura = pos;
  }
  return out;
}
