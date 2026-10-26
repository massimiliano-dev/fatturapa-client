import { describe, expect, it } from 'vitest';
import { AcubeProvider } from '../src/index.js';

// SANDBOX ONLY (never reaches the SDI), read-only.
const email = process.env.ACUBE_SANDBOX_EMAIL;
const password = process.env.ACUBE_SANDBOX_PASSWORD;
const enabled = process.env.FATTURAPA_LIVE === 'sandbox' && Boolean(email && password);

describe.skipIf(!enabled)('A-Cube sandbox', () => {
  it('logs in and lists invoices', async () => {
    const provider = new AcubeProvider({
      environment: 'sandbox',
      credentials: { email: email!, password: password! },
    });
    try {
      expect(Array.isArray(await provider.listInvoices({ page: 1 }))).toBe(true);
    } finally {
      await provider.close();
    }
  });
});
