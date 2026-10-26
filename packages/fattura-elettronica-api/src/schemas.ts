import { z } from 'zod';

// Bounded schemas following https://www.fattura-elettronica-api.it/docs/fattura-elettronica-api.yaml (2.0).
const s = (max = 1000) => z.string().max(max).nullish();
const id = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^\d{1,18}$/)
    .transform(Number),
]);

export const FEA_STATES = ['INVI', 'PREN', 'ERRO', 'CONS', 'NONC', 'ACCE', 'RIFI', 'DECO'] as const;
export type FeaState = (typeof FEA_STATES)[number];

export const sendResponse = z.object({
  id,
  sdi_identificativo: id.nullish(),
  sdi_nome_file: s(),
  /** The XML actually transmitted (DatiTrasmissione rewritten by the provider). Personal data. */
  sdi_fattura: z
    .string()
    .max(20 * 1024 * 1024)
    .nullish(),
  sdi_stato: s(10),
  sdi_messaggio: s(10_000),
});

export const fattura = z.object({
  ricezione: z.union([z.literal(0), z.literal(1)]).nullish(),
  id,
  partita_iva: s(50),
  sdi_fattura_base64: z
    .string()
    .max(30 * 1024 * 1024)
    .nullish(),
  sdi_fattura_xml: z
    .string()
    .max(20 * 1024 * 1024)
    .nullish(),
  sdi_identificativo: id.nullish(),
  sdi_stato: s(10),
  sdi_data_aggiornamento: s(50),
  sdi_messaggio: s(10_000),
  sdi_nome_file: s(),
  origine: s(5),
  dati_documento: z.record(z.string(), z.unknown()).nullish(),
});
export type FeaFattura = z.infer<typeof fattura>;

export const authResponse = z.object({ token: z.string().min(1).max(8192), expires: z.string().max(50) });

export const webhookPayload = z.object({
  event: z.enum(['fattura-ricezione', 'fattura-aggiornamento']),
  fattura,
});
