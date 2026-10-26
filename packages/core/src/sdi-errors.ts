/**
 * SDI rejection codes (Ricevuta/Notifica di scarto), from "Allegato A - Specifiche tecniche vers 1.9.1",
 * Appendice 1 (Agenzia delle Entrate, updated 31 March 2026, usable from 15 May 2026). Descriptions are
 * the official ones for the ordinary invoice, shortened to the first sentence. GENERATED: do not edit by hand.
 */
export const SDI_ERROR_CODES = {
  "00001": { description: "Nome file non valido", appliesTo: "both" },
  "00002": { description: "Nome file duplicato", appliesTo: "both" },
  "00003": { description: "Le dimensioni del file superano quelle ammesse", appliesTo: "both" },
  "00100": { description: "Certificato di firma scaduto", appliesTo: "both" },
  "00101": { description: "Certificato di firma revocato", appliesTo: "both" },
  "00102": { description: "La firma elettronica apposta al file non risulta valida", appliesTo: "both" },
  "00103": { description: "Alla firma elettronica apposta al file manca il riferimento temporale", appliesTo: "both" },
  "00104": { description: "La CA (Certification Authority) che ha emesso il certificato di firma non risulta nell'elenco delle CA affidabili", appliesTo: "both" },
  "00105": { description: "Il riferimento temporale associato alla firma elettronica apposta al file è successivo alla data di ricezione del file", appliesTo: "both" },
  "00106": { description: "Il file compresso è vuoto oppure non è leggibile", appliesTo: "both" },
  "00107": { description: "Il certificato di firma non è valido", appliesTo: "both" },
  "00200": { description: "File non conforme al formato", appliesTo: "both" },
  "00201": { description: "Non è possibile procedere con ulteriori controlli perché gli errori di formato presenti nel file superano il numero massimo previsto (50)", appliesTo: "both" },
  "00300": { description: "1.1.1.2 <IdCodice> non valido", appliesTo: "both" },
  "00301": { description: "1.2.1.1.2 <IdCodice> non valido", appliesTo: "both" },
  "00303": { description: "1.3.1.1.2 <IdCodice> o 1.4.4.1.2 <IdCodice> non valido", appliesTo: "both" },
  "00305": { description: "1.4.1.1.2 <IdCodice> non valido", appliesTo: "both" },
  "00306": { description: "1.4.1.2 <CodiceFiscale> non valido", appliesTo: "both" },
  "00311": { description: "1.1.4 <CodiceDestinatario> non valido", appliesTo: "both" },
  "00312": { description: "1.1.4 <CodiceDestinatario> non attivo", appliesTo: "both" },
  "00313": { description: "l'elemento 1.1.4 <CodiceDestinatario> può essere valorizzato con “XXXXXXX” per comunicare i dati di fatture emesse esclusivamente verso soggetti non residenti", appliesTo: "both" },
  "00320": { description: "1.2.1.1 <IdFiscaleIVA> e 1.2.1.2 <CodiceFiscale> non coerenti", appliesTo: "both" },
  "00321": { description: "1.2.1.2 <CodiceFiscale> di soggetto non partecipante al gruppo IVA", appliesTo: "both" },
  "00322": { description: "1.2.1.2 <CodiceFiscale> non presente a fronte di 1.2.1.1 <IdFiscaleIVA> di gruppo IVA", appliesTo: "both" },
  "00323": { description: "1.2.1.1.2 <IdCodice> corrispondente a una partita IVA cessata da oltre 5 anni", appliesTo: "ordinaria" },
  "00324": { description: "1.4.1.1 <IdFiscaleIVA> e 1.4.1.2 <CodiceFiscale> non coerenti", appliesTo: "both" },
  "00325": { description: "1.4.1.2 <CodiceFiscale> di soggetto non partecipante al gruppo IVA", appliesTo: "both" },
  "00326": { description: "1.4.1.2 <CodiceFiscale> non presente a fronte di 1.4.1.1 <IdFiscaleIVA> di gruppo IVA", appliesTo: "both" },
  "00327": { description: "1.4.1.2 <CodiceFiscale> di gruppo IVA non riferito ad un partecipante, in assenza di <IdFiscaleIVA> di gruppo IVA", appliesTo: "both" },
  "00330": { description: "1.1.6 <PECDestinatario> contenente un valore non ammesso", appliesTo: "both" },
  "00400": { description: "2.2.1.14 <Natura> non presente a fronte di 2.2.1.12 <AliquotaIVA> pari a zero", appliesTo: "both" },
  "00401": { description: "2.2.1.14 <Natura> presente a fronte di 2.2.1.12 <AliquotaIVA> diversa da zero", appliesTo: "both" },
  "00403": { description: "2.1.1.3 <Data> successiva alla data di ricezione", appliesTo: "both" },
  "00404": { description: "Fattura duplicata", appliesTo: "both" },
  "00409": { description: "Fattura duplicata nel lotto", appliesTo: "both" },
  "00411": { description: "2.1.1.5 <DatiRitenuta> non presente a fronte di almeno un blocco 2.2.1 <DettaglioLinee> con 2.2.1.13 <Ritenuta> uguale a SI", appliesTo: "ordinaria" },
  "00413": { description: "2.1.1.7.7 <Natura> non presente a fronte di 2.1.1.7.5 <AliquotaIVA> pari a zero", appliesTo: "ordinaria" },
  "00414": { description: "2.1.1.7.7 <Natura> presente a fronte di 2.1.1.7.5 <AliquotaIVA> diversa da zero", appliesTo: "ordinaria" },
  "00415": { description: "2.1.1.5 <DatiRitenuta> non presente a fronte di 2.1.1.7.6 <Ritenuta> uguale a SI", appliesTo: "ordinaria" },
  "00417": { description: "1.4.1.1 <IdFiscaleIVA> e 1.4.1.2 <CodiceFiscale> non valorizzati", appliesTo: "both" },
  "00418": { description: "2.1.1.3 <Data> antecedente a 2.1.6.3 <Data>", appliesTo: "both" },
  "00419": { description: "2.2.2 <DatiRiepilogo> non presente in corrispondenza di almeno un valore di 2.1.1.7.5 <AliquotaIVA> o 2.2.1.12 <AliquotaIVA>", appliesTo: "ordinaria" },
  "00420": { description: "2.2.2.2 <Natura> con valore di tipo N6 a fronte di 2.2.2.7 <EsigibilitaIVA> uguale a S (scissione pagamenti)", appliesTo: "ordinaria" },
  "00421": { description: "2.2.2.6 <Imposta> non calcolato secondo le regole definite nelle specifiche tecniche", appliesTo: "ordinaria" },
  "00422": { description: "2.2.2.5 <ImponibileImporto> non calcolato secondo le regole definite nelle specifiche tecniche", appliesTo: "ordinaria" },
  "00423": { description: "2.2.1.11 <PrezzoTotale> non calcolato secondo le regole definite nelle specifiche tecniche", appliesTo: "ordinaria" },
  "00424": { description: "2.2.1.12 <AliquotaIVA> o 2.2.2.1 <AliquotaIVA> o 2.1.1.7.5 <AliquotaIVA> non indicata in termini percentuali", appliesTo: "both" },
  "00425": { description: "2.1.1.4 <Numero> non contenente caratteri numerici", appliesTo: "both" },
  "00427": { description: "1.1.4 <CodiceDestinatario> di 7 caratteri a fronte di 1.1.3 <FormatoTrasmissione> con valore FPA12 o 1.1.4 <CodiceDestinatario> di 6 caratteri a fronte di 1.1.3 <FormatoTrasmissione> con valore FPR12", appliesTo: "ordinaria" },
  "00428": { description: "1.1.3 <FormatoTrasmissione> non coerente con il valore dell'attributo VERSION", appliesTo: "both" },
  "00429": { description: "2.2.2.2 <Natura> non presente a fronte di 2.2.2.1 <AliquotaIVA> pari a zero", appliesTo: "ordinaria" },
  "00430": { description: "2.2.2.2 <Natura> presente a fronte di 2.2.2.1 <AliquotaIVA> diversa da zero", appliesTo: "ordinaria" },
  "00437": { description: "2.1.1.8.2 <Percentuale> e 2.1.1.8.3 <Importo> non presenti a fronte di 2.1.1.8.1 <Tipo> valorizzato", appliesTo: "ordinaria" },
  "00438": { description: "2.2.1.10.2 <Percentuale> e 2.2.1.10.3 <Importo> non presenti a fronte di 2.2.1.10.1 <Tipo> valorizzato", appliesTo: "ordinaria" },
  "00443": { description: "non c'è corrispondenza tra i valori indicati nell'elemento 2.2.1.12 <AliquotaIVA> o 2.1.1.7.5 <AliquotaIVA> e quelli dell'elemento 2.2.2.1 <AliquotaIVA>", appliesTo: "ordinaria" },
  "00444": { description: "non c'è corrispondenza tra i valori indicati nell'elemento 2.2.1.14 <Natura> o 2.1.1.7.7 <Natura> e quelli dell'elemento 2.2.2.2 <Natura>", appliesTo: "ordinaria" },
  "00445": { description: "non è più ammesso il valore generico N2, N3 o N6 come codice natura dell'operazione", appliesTo: "both" },
  "00460": { description: "Importo totale superiore al limite previsto per le fatture semplificate ai sensi del DPR 633/72, art. 21 bis", appliesTo: "semplificata" },
  "00471": { description: "per il valore indicato nell'elemento 2.1.1.1 <TipoDocumento> il cedente/prestatore non può essere uguale al cessionario/committente", appliesTo: "both" },
  "00472": { description: "per il valore indicato nell'elemento 2.1.1.1 <TipoDocumento> il cedente/prestatore deve essere uguale al cessionario/committente", appliesTo: "ordinaria" },
  "00473": { description: "per il valore indicato nell'elemento 2.1.1.1 <TipoDocumento> il valore presente nell'elemento 1.2.1.1.1 <IdPaese> non è ammesso", appliesTo: "ordinaria" },
  "00474": { description: "per il valore indicato nell'elemento 2.1.1.1 <TipoDocumento> non sono ammesse linee di dettaglio con l'elemento 2.2.1.12 <AliquotaIVA> contenente valore zero", appliesTo: "ordinaria" },
  "00475": { description: "per il valore indicato nell'elemento 2.1.1.1 <TipoDocumento> deve essere presente l'elemento 1.4.1.1 <IdFiscaleIVA> del cessionario/committente", appliesTo: "ordinaria" },
  "00476": { description: "gli elementi 1.2.1.1.1 <IdPaese> e 1.4.1.1.1 <IdPaese> non possono essere entrambi valorizzati con codice diverso da IT", appliesTo: "both" },
  "00477": { description: "fattura recante titolo di non imponibilità ai fini IVA ai sensi dell'art. 8, comma 1, lett. c) DPR 26 ottobre 1972, n. 633, con Dichiarazione d'intento invalidata", appliesTo: "both" },
} as const satisfies Record<string, { description: string; appliesTo: 'both' | 'ordinaria' | 'semplificata' }>;

/** A rejection code documented in the technical specifications. */
export type SdiErrorCode = keyof typeof SDI_ERROR_CODES;

/** Returns the official description of an SDI error code, or undefined for unknown codes. */
export function describeSdiError(code: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SDI_ERROR_CODES, code)
    ? SDI_ERROR_CODES[code as SdiErrorCode].description
    : undefined;
}
