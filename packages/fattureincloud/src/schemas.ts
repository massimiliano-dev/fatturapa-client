import { z } from 'zod';

// Bounded, lenient response schemas following openapi-fattureincloud 2.1.8 (commit 362e3fe).
const s = (max = 1000) => z.string().max(max).nullish();
const n = () => z.number().nullish();

export const FIC_EI_STATUSES = [
  'attempt',
  'missing',
  'not_sent',
  'sent',
  'pending',
  'processing',
  'error',
  'discarded',
  'not_delivered',
  'accepted',
  'rejected',
  'no_response',
  'manual_accepted',
  'manual_rejected',
] as const;
export type FicEInvoiceStatus = (typeof FIC_EI_STATUSES)[number];

export const vatType = z.object({
  id: z.number().int(),
  value: n(),
  description: s(),
  e_invoice: z.boolean().nullish(),
  ei_type: s(20),
  ei_description: s(),
  is_disabled: z.boolean().nullish(),
});
export type FicVatType = z.infer<typeof vatType>;

export const issuedDocument = z
  .object({
    id: z.number().int(),
    type: s(50),
    number: n(),
    numeration: s(100),
    date: s(20),
    e_invoice: z.boolean().nullish(),
    ei_status: s(50),
    amount_net: n(),
    amount_vat: n(),
    amount_gross: n(),
  })
  .passthrough();
export type FicIssuedDocument = z.infer<typeof issuedDocument>;

export const dataOf = <T extends z.ZodTypeAny>(data: T) => z.object({ data: data.nullish() });

export const listVatTypes = dataOf(z.array(vatType).max(1000));
export const issuedDocumentResponse = dataOf(issuedDocument);
export const sendEInvoiceResponse = dataOf(z.object({ name: s(), date: s(50) }));
export const verifyXmlResponse = dataOf(z.object({ success: z.boolean().nullish() }));
export const verifyXmlError = z.object({
  error: z
    .object({
      message: s(10_000),
      validation_result: z.object({ xml_errors: z.array(z.string().max(2000)).max(200).nullish() }).nullish(),
    })
    .nullish(),
  extra: z.object({ errors: z.array(z.string().max(2000)).max(200).nullish() }).nullish(),
});
export const rejectionReason = dataOf(
  z.object({ reason: s(10_000), ei_status: s(50), solution: s(10_000), code: s(50), date: s(50) }),
);

export const subscription = z.object({
  id: s(100),
  sink: s(2000),
  verified: z.boolean().nullish(),
  types: z.array(z.string().max(200)).max(200).nullish(),
  config: z.object({ mapping: s(20) }).nullish(),
  verification_method: s(20),
});
export const subscriptionResponse = dataOf(subscription);
export const subscriptionsResponse = dataOf(z.array(subscription).max(1000));

export const receivedDocument = z
  .object({
    id: z.number().int(),
    type: s(50),
    date: s(20),
    e_invoice: z.boolean().nullish(),
    amount_gross: n(),
  })
  .passthrough();
export const listReceivedDocuments = z.object({
  data: z.array(receivedDocument).max(1000).nullish(),
  current_page: n(),
  last_page: n(),
  total: n(),
});
