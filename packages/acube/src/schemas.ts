import { z } from 'zod';

// Bounded schemas following https://docs.acubeapi.com/openapi/gov-it-api.json (A-Cube API Italy 1.22.5).
const s = (max = 1000) => z.string().max(max).nullish();

export const created = z.object({ uuid: z.string().min(1).max(100) });

export const invoice = z.object({
  uuid: z.string().max(100),
  created_at: s(50),
  type: z.union([z.number(), z.string().max(10)]).nullish(),
  marking: s(100),
  notice: s(10_000),
  sdi_file_name: s(),
  sdi_file_id: z.union([z.string().max(100), z.number()]).nullish(),
  signed: z.boolean().nullish(),
  legally_stored: z.boolean().nullish(),
  transmission_format: s(10),
  document_type: s(10),
  to_pa: z.boolean().nullish(),
  /** The invoice. Personal data: never log. */
  payload: z.union([z.string().max(20 * 1024 * 1024), z.record(z.string(), z.unknown())]).nullish(),
});
export type AcubeInvoice = z.infer<typeof invoice>;

export const notification = z
  .object({
    uuid: s(100),
    invoice_uuid: s(100),
    created_at: s(50),
    type: s(10),
    message: z.record(z.string(), z.unknown()).nullish(),
    downloaded: z.boolean().nullish(),
    file_name: s(),
  })
  .passthrough();
export type AcubeNotification = z.infer<typeof notification>;

export const apiConfiguration = z.object({
  uuid: s(100),
  event: s(100),
  target_url: s(2000),
  authentication_type: s(20),
  authentication_key: s(200),
});
export type AcubeApiConfiguration = z.infer<typeof apiConfiguration>;

export const businessRegistryConfiguration = z
  .object({
    fiscal_id: s(100),
    name: s(500),
    email: s(500),
    apply_signature: z.boolean().nullish(),
    apply_legal_storage: z.boolean().nullish(),
  })
  .passthrough();

/** Collections are plain arrays with `Accept: application/json`, or Hydra objects with ld+json. */
export const collection = <T extends z.ZodTypeAny>(item: T) =>
  z.union([
    z.array(item).max(1000),
    z.object({ 'hydra:member': z.array(item).max(1000) }).transform((h) => h['hydra:member']),
  ]);

export const loginResponse = z.object({ token: z.string().min(1).max(16_384) });
