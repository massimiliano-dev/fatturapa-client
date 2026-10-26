import { z } from 'zod';

// Bounded, lenient schemas following https://api.invoicetronic.com/v1/docs/swagger.json (1.20.2, MIT).
const s = (max = 1000) => z.string().max(max).nullish();

export const INVOICETRONIC_STATES = [
  'Inviato',
  'Consegnato',
  'NonConsegnato',
  'Scartato',
  'AccettatoDalDestinatario',
  'RifiutatoDalDestinatario',
  'ImpossibilitaDiRecapito',
  'DecorrenzaTermini',
  'AttestazioneTrasmissioneFattura',
] as const;
export type InvoicetronicState = (typeof INVOICETRONIC_STATES)[number];

const documentData = z.object({ number: s(100), date: s(50) });

export const send = z.object({
  id: z.number().int(),
  created: s(50),
  company_id: z.number().int().nullish(),
  committente: s(100),
  prestatore: s(100),
  identifier: s(100),
  file_name: s(200),
  format: s(10),
  /** Personal data: never log. */
  payload: z
    .string()
    .max(20 * 1024 * 1024)
    .nullish(),
  encoding: s(10),
  last_update: s(50),
  date_sent: s(50),
  documents: z.array(documentData).max(1000).nullish(),
  latest_state: s(50),
  meta_data: z.unknown().optional(),
});
export type InvoicetronicSend = z.infer<typeof send>;

export const sdiError = z.object({ code: s(50), description: s(5000), hint: s(5000) });

export const update = z.object({
  id: z.number().int(),
  send_id: z.number().int().nullish(),
  last_update: s(50),
  state: s(50),
  description: s(5000),
  message_id: s(100),
  errors: z.array(sdiError).max(200).nullish(),
  is_read: z.boolean().nullish(),
});
export type InvoicetronicUpdate = z.infer<typeof update>;

export const receive = z.object({
  id: z.number().int(),
  company_id: z.number().int().nullish(),
  committente: s(100),
  prestatore: s(100),
  identifier: s(100),
  file_name: s(200),
  format: s(10),
  payload: z
    .string()
    .max(20 * 1024 * 1024)
    .nullish(),
  encoding: s(10),
  date_sent: s(50),
  documents: z.array(documentData).max(1000).nullish(),
  nome_prestatore: s(500),
  is_read: z.boolean().nullish(),
  message_id: s(100),
});
export type InvoicetronicReceive = z.infer<typeof receive>;

export const webhook = z.object({
  id: z.number().int(),
  company_id: z.number().int().nullish(),
  url: s(2000),
  enabled: z.boolean().nullish(),
  /** Only returned on creation. */
  secret: z.string().max(500).nullish(),
  description: s(1000),
  events: z.array(z.string().max(100)).max(100).nullish(),
});
export type InvoicetronicWebhook = z.infer<typeof webhook>;

export const status = z.object({
  operation_left: z.number().int().nullish(),
  signature_left: z.number().int().nullish(),
  has_active_seat: z.boolean().nullish(),
  is_sub_key: z.boolean().nullish(),
});

export const company = z.object({ id: z.number().int(), vat: s(50), fiscal_code: s(50), name: s(500) });
export type InvoicetronicCompany = z.infer<typeof company>;
