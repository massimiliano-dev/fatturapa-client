import { z } from 'zod';

// Response schemas are lenient (unknown fields are dropped) but bounded: every string has a maximum
// length and every list a maximum size. They follow https://console.openapi.com/oas/en/sdi.openapi.json
// (SDI 1.0.0, downloaded 2026-10-26).
const s = (max = 1000) => z.string().max(max).nullish();

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data: data.nullish(),
    success: z.boolean().nullish(),
    message: s(10_000),
    error: z.unknown().optional(),
  });

export const createInvoiceResponse = envelope(z.object({ uuid: z.string().min(1).max(100) }));

const notificationMessage = z
  .object({
    identificativo_sdi: z.union([z.string().max(100), z.number()]).nullish(),
    nome_file: s(),
    data_ora_ricezione: s(),
    lista_errori: z.unknown().optional(),
    note: s(10_000),
    esito: s(10),
    descrizione: s(10_000),
  })
  .passthrough();

export const notification = z.object({
  uuid: s(100),
  invoice_uuid: s(100),
  created_at: s(100),
  type: s(10),
  message: notificationMessage.nullish(),
  file_name: s(),
});

export const invoice = z.object({
  uuid: z.string().max(100),
  created_at: s(100),
  type: z.union([z.number(), z.string().max(10)]).nullish(),
  marking: s(100),
  notice: s(10_000),
  sdi_file_name: s(),
  sdi_file_id: z.union([z.string().max(100), z.number()]).nullish(),
  signed: z.boolean().nullish(),
  legally_stored: z.boolean().nullish(),
  transmission_format: s(10),
  to_pa: z.boolean().nullish(),
  /** The invoice XML. Personal data: returned to the caller, never logged. */
  payload: z
    .string()
    .max(20 * 1024 * 1024)
    .nullish(),
});

export const getInvoiceResponse = envelope(invoice);
export const listInvoicesResponse = envelope(z.array(invoice).max(1000));
export const listNotificationsResponse = envelope(z.array(notification).max(1000));

export const businessRegistryConfiguration = z.object({
  id: s(100),
  fiscal_id: s(100),
  name: s(),
  email: s(),
  apply_signature: z.boolean().nullish(),
  apply_legal_storage: z.boolean().nullish(),
  active: z.boolean().nullish(),
});

export const callback = z.object({ event: s(100), url: s(2000), auth_header: s(2000), field: s(100) });
export const apiConfiguration = z.object({
  id: s(100),
  fiscal_id: s(100),
  callbacks: z.union([z.array(callback).max(50), callback]).nullish(),
});

export const tokenResponse = z.object({
  token: z.string().min(1).max(4096),
  expire: z.number().nullish(),
  scopes: z.array(z.string().max(500)).max(1000).nullish(),
  success: z.boolean().nullish(),
});
