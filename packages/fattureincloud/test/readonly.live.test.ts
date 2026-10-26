import { describe, expect, it } from 'vitest';
import { FattureInCloudProvider } from '../src/index.js';

// READ-ONLY: Fatture in Cloud has no sandbox, so the live test never creates or sends documents.
const token = process.env.FIC_ACCESS_TOKEN;
const company = Number(process.env.FIC_COMPANY_ID);
const enabled =
  process.env.FATTURAPA_LIVE === 'sandbox' && Boolean(token) && Number.isSafeInteger(company) && company > 0;

describe.skipIf(!enabled)('Fatture in Cloud (read-only)', () => {
  it('lists the VAT types of the company', async () => {
    const provider = new FattureInCloudProvider({ companyId: company, accessToken: token! });
    try {
      const vatTypes = await provider.listVatTypes();
      expect(vatTypes.length).toBeGreaterThan(0);
    } finally {
      await provider.close();
    }
  });
});
