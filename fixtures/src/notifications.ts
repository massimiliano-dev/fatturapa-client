/**
 * SYNTHETIC SDI notifications, written from the official schemas MessaggiTypes_v1.1.xsd (PA namespace)
 * and MessaggiFatturaTypes_v1.0.xsd (B2B namespace). Identifiers are fake; signatures are omitted.
 */
const PA = 'http://www.fatturapa.gov.it/sdi/messaggi/v1.0';
const B2B = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fattura/messaggi/v1.0';
const FILE = 'IT01234567897_00001.xml';

export const RC_PA = `<?xml version="1.0" encoding="UTF-8"?>
<types:RicevutaConsegna xmlns:types="${PA}" versione="1.0">
  <IdentificativoSdI>111</IdentificativoSdI>
  <NomeFile>${FILE}</NomeFile>
  <DataOraRicezione>2026-05-20T10:00:00.000+02:00</DataOraRicezione>
  <DataOraConsegna>2026-05-20T10:05:00.000+02:00</DataOraConsegna>
  <Destinatario><Codice>AAAAAA</Codice><Descrizione>Ufficio di prova</Descrizione></Destinatario>
  <MessageId>123456</MessageId>
  <Note>Ricevuta di prova</Note>
</types:RicevutaConsegna>`;

export const NS_PA = `<?xml version="1.0" encoding="UTF-8"?>
<types:NotificaScarto xmlns:types="${PA}" versione="1.0">
  <IdentificativoSdI>112</IdentificativoSdI>
  <NomeFile>${FILE}</NomeFile>
  <DataOraRicezione>2026-05-20T10:00:00.000+02:00</DataOraRicezione>
  <ListaErrori>
    <Errore><Codice>00400</Codice><Descrizione>2.2.1.14 Natura non presente</Descrizione></Errore>
    <Errore><Codice>00423</Codice><Descrizione>2.2.1.11 PrezzoTotale non calcolato</Descrizione></Errore>
  </ListaErrori>
  <MessageId>123457</MessageId>
</types:NotificaScarto>`;

export const NE_PA_REFUSED = `<?xml version="1.0" encoding="UTF-8"?>
<types:NotificaEsito xmlns:types="${PA}" versione="1.0">
  <IdentificativoSdI>113</IdentificativoSdI>
  <NomeFile>${FILE}</NomeFile>
  <EsitoCommittente versione="1.0">
    <IdentificativoSdI>113</IdentificativoSdI>
    <RiferimentoFattura><NumeroFattura>FPA 1/26</NumeroFattura><AnnoFattura>2026</AnnoFattura></RiferimentoFattura>
    <Esito>EC02</Esito>
    <Descrizione>Importo non corretto</Descrizione>
  </EsitoCommittente>
  <MessageId>123458</MessageId>
</types:NotificaEsito>`;

export const MT_PA = `<?xml version="1.0" encoding="UTF-8"?>
<types:MetadatiInvioFile xmlns:types="${PA}" versione="1.0">
  <IdentificativoSdI>114</IdentificativoSdI>
  <NomeFile>${FILE}</NomeFile>
  <CodiceDestinatario>AAAAAAA</CodiceDestinatario>
  <Formato>FPR12</Formato>
  <TentativiInvio>1</TentativiInvio>
  <MessageId>123459</MessageId>
</types:MetadatiInvioFile>`;

export const NS_B2B = `<?xml version="1.0" encoding="UTF-8"?>
<types:RicevutaScarto xmlns:types="${B2B}">
  <IdentificativoSdI>115</IdentificativoSdI>
  <NomeFile>${FILE}</NomeFile>
  <Hash>0000000000000000000000000000000000000000000000000000000000000000</Hash>
  <DataOraRicezione>2026-05-20T10:00:00.000+02:00</DataOraRicezione>
  <ListaErrori>
    <Errore><Codice>00305</Codice><Descrizione>1.4.1.1.2 IdCodice non valido</Descrizione><Suggerimento>Verificare la partita IVA</Suggerimento></Errore>
  </ListaErrori>
  <MessageId>123460</MessageId>
</types:RicevutaScarto>`;
