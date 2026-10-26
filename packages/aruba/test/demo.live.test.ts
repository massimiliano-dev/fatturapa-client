import { describe, expect, it } from 'vitest';
import { ArubaProvider } from '../src/index.js';

// DEMO environment only, read-only (Aruba allows one login per minute per IP).
const username = process.env.ARUBA_DEMO_USERNAME;
const password = process.env.ARUBA_DEMO_PASSWORD;
const enabled = process.env.FATTURAPA_LIVE === 'sandbox' && Boolean(username && password);

describe.skipIf(!enabled)('Aruba demo', () => {
  it('searches the sent invoices of the last two days', async () => {
    const provider = new ArubaProvider({
      environment: 'demo',
      credentials: { username: username!, password: password! },
    });
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 2 * 86_400_000 + 60_000);
      const result = await provider.searchInvoices('out', {
        creationStartDate: start.toISOString(),
        creationEndDate: end.toISOString(),
      });
      expect(Array.isArray(result.content)).toBe(true);
    } finally {
      await provider.close();
    }
  });
});
