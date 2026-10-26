/**
 * Webhook event types relevant to e-invoicing (developers.fattureincloud.it/docs/webhooks/notification-types).
 * Group types such as `it.fattureincloud.webhooks.issued_documents.all.create` are also accepted when
 * creating a subscription.
 */
export const FIC_WEBHOOK_EVENT_TYPES = [
  'it.fattureincloud.webhooks.issued_documents.e_invoices.status_update',
  'it.fattureincloud.webhooks.received_documents.e_invoices.receive',
  'it.fattureincloud.webhooks.issued_documents.invoices.create',
  'it.fattureincloud.webhooks.issued_documents.invoices.update',
  'it.fattureincloud.webhooks.issued_documents.invoices.delete',
  'it.fattureincloud.webhooks.issued_documents.credit_notes.create',
  'it.fattureincloud.webhooks.issued_documents.credit_notes.update',
  'it.fattureincloud.webhooks.issued_documents.credit_notes.delete',
  'it.fattureincloud.webhooks.received_documents.create',
  'it.fattureincloud.webhooks.received_documents.update',
  'it.fattureincloud.webhooks.received_documents.delete',
  'it.fattureincloud.webhooks.entities.clients.create',
  'it.fattureincloud.webhooks.entities.clients.update',
  'it.fattureincloud.webhooks.entities.clients.delete',
  'it.fattureincloud.webhooks.subscriptions.welcome',
] as const;
export type FicWebhookEventType = (typeof FIC_WEBHOOK_EVENT_TYPES)[number];
