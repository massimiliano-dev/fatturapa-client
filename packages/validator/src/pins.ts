/**
 * Official schemas used for validation, pinned by SHA-256. `pnpm sync:schemas` downloads them into
 * `vendor/fatturapa-schemas/` (gitignored) and refuses any file whose hash differs; the loader checks the
 * hashes again before use, so a tampered vendor folder is detected.
 *
 * Sources (checked 2026-10-26):
 * - FatturaPA ordinary invoice schema 1.2.3, "Documentazione valida dal 1 aprile 2025" on fatturapa.gov.it,
 *   also published as "Schema_VFPR12" with the technical specifications 1.9.1 usable from 15 May 2026.
 *   The FPA12 file `Schema_VFPA12_V1.2.3.xsd` is byte-identical (same SHA-256).
 * - SDI notifications for PA invoices, `MessaggiTypes_v1.1.xsd` (Documentazione SDI).
 * - SDI notifications, B2B namespace, `MessaggiFatturaTypes_v1.0.xsd` (Agenzia delle Entrate, specifiche 1.9.1).
 * - W3C XML Signature schema (REC-xmldsig-core-20020212), imported by all of the above.
 */
export interface PinnedSchema {
  fileName: string;
  url: string;
  sha256: string;
}

export const PINNED_SCHEMAS = [
  {
    fileName: 'Schema_VFPR12_v1.2.3.xsd',
    url: 'https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.4/Schema_VFPR12_v1.2.3.xsd',
    sha256: '152944f6eef9f5d69ef6e955ee173b32142b00a8c1c5222fc97dfab5910e8a8c',
  },
  {
    fileName: 'MessaggiTypes_v1.1.xsd',
    url: 'https://www.fatturapa.gov.it/export/documenti/messaggi/v1.1/MessaggiTypes_v1.1.xsd',
    sha256: '6885c70b10593a42a1278fd4bb90386fa47b6c62a8557b80c71a1a0bf215ea6d',
  },
  {
    fileName: 'MessaggiFatturaTypes_v1.0.xsd',
    url: 'https://www.agenziaentrate.gov.it/portale/documents/20143/288192/ST+Fatturazione+elettronica+-+MessaggiFatturaTypes_MessaggiFatturaTypes_v1.0.xsd/2b799419-1311-d901-80cf-8a64d4e23522',
    sha256: '24f91e8dd3839fee76b06cfd3dbbca74c71822fe6d2b66545d065a313ded7359',
  },
  {
    fileName: 'xmldsig-core-schema.xsd',
    url: 'https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd',
    sha256: '35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c',
  },
] as const satisfies readonly PinnedSchema[];

/** Default folder, relative to the repository root, written by `pnpm sync:schemas`. */
export const DEFAULT_SCHEMAS_DIR = 'vendor/fatturapa-schemas';
