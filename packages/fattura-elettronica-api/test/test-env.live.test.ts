import { describe, expect, it } from 'vitest';
import { FatturaElettronicaApiProvider } from '../src/index.js';

// TEST environment only, read-only.
const clientId = process.env.FEA_TEST_CLIENT_ID;
const clientSecret = process.env.FEA_TEST_CLIENT_SECRET;
const enabled = process.env.FATTURAPA_LIVE === 'sandbox' && Boolean(clientId && clientSecret);

describe.skipIf(!enabled)('Fattura Elettronica API test environment', () => {
  it('authenticates and lists updates', async () => {
    const provider = new FatturaElettronicaApiProvider({
      environment: 'test',
      credentials: { clientId: clientId!, clientSecret: clientSecret! },
    });
    try {
      expect(Array.isArray(await provider.listFatture({ per_page: 10 }))).toBe(true);
    } finally {
      await provider.close();
    }
  });
});
