import { z } from 'zod';

// Bounded schemas following https://fatturazioneelettronica.aruba.it/apidoc/v2/docs_EN.html (2.6.0).
const s = (max = 1000) => z.string().max(max).nullish();

export const signinResponse = z.object({
  access_token: z.string().min(1).max(8192),
  token_type: s(20),
  expires_in: z.number().int().positive().max(86_400),
  refresh_token: z.string().max(8192).nullish(),
});

export const uploadResponse = z.object({
  errorCode: s(20),
  errorDescription: s(10_000),
  uploadFileName: s(200),
});

const company = z.object({ description: s(500), countryCode: s(5), vatCode: s(50), fiscalCode: s(50) });

const document = z.object({
  invoiceDate: s(50),
  number: s(100),
  documentType: s(10),
  status: s(100),
  statusDescription: s(10_000),
  totalDocument: z.union([z.number(), z.string().max(50)]).nullish(),
});

export const invoiceItem = z.object({
  id: z.union([z.string().max(100), z.number()]),
  sender: company.nullish(),
  receiver: company.nullish(),
  invoiceType: s(10),
  docType: s(5),
  /** Base64 of the invoice file (XML or P7M). Personal data. */
  file: z
    .string()
    .max(30 * 1024 * 1024)
    .nullish(),
  filename: s(200),
  creationDate: s(50),
  lastUpdate: s(50),
  idSdi: z.union([z.string().max(50), z.number()]).nullish(),
  invoices: z.array(document).max(1000).nullish(),
  sdiErrors: z
    .array(z.union([z.string().max(5000), z.record(z.string(), z.unknown())]))
    .max(200)
    .nullish(),
});
export type ArubaInvoice = z.infer<typeof invoiceItem>;

export const page = z.object({
  content: z.array(invoiceItem).max(1000),
  totalElements: z.number().int().nullish(),
  totalPages: z.number().int().nullish(),
  last: z.boolean().nullish(),
});

export const notificationsResponse = z.object({
  count: z.number().int().nullish(),
  notifications: z
    .array(
      z.object({
        date: s(50),
        docType: s(10),
        file: z
          .string()
          .max(5 * 1024 * 1024)
          .nullish(),
        filename: s(200),
        invoiceId: z.union([z.string().max(100), z.number()]).nullish(),
        notificationDate: s(50),
        result: s(10),
      }),
    )
    .max(1000),
});
export type ArubaNotification = z.infer<typeof notificationsResponse>['notifications'][number];

const b64 = z.string().max(30 * 1024 * 1024);
export const callbackCreateInvoice = z.object({
  username: z.string().max(200),
  countryCode: z.string().max(5),
  vatCode: z.string().max(50),
  fiscalCode: z.string().max(50),
  sdiIdentification: z.string().max(50),
  sdiInvoiceFileName: z.string().max(200),
  invoiceXmlBase64: b64,
  sdiMetadataFileName: z.string().max(200),
  metadataXmlBase64: b64,
});
export const callbackCreateNotification = z.object({
  username: z.string().max(200),
  countryCode: z.string().max(5),
  vatCode: z.string().max(50),
  fiscalCode: z.string().max(50),
  inOut: z.enum(['IN', 'OUT']),
  notifyType: z.string().max(20),
  sdiIdentification: z.string().max(50),
  notifyFileName: z.string().max(200),
  notifyXmlBase64: b64,
  notificationDate: z.string().max(50).nullish(),
});
export const callbackUpdateInvoiceStatus = z.object({
  username: z.string().max(200),
  countryCode: z.string().max(5),
  vatCode: z.string().max(50),
  fiscalCode: z.string().max(50),
  invoiceFileName: z.string().max(200),
  sdiIdentification: z.string().max(50).nullish(),
  status: z.string().max(100),
  errorDescription: z.string().max(10_000).nullish(),
  updateDate: z.string().max(50).nullish(),
});
