import { describe, expect, it } from 'vitest';

import { previewAtlasResponse } from '../api/atlas';

describe('Vercel Atlas preview boundary', () => {
  it('serves the read-only bootstrap contract from the preview function', async () => {
    await expect(previewAtlasResponse('bootstrap', 'GET')).resolves.toEqual({
      status: 200,
      body: {
        ok: true,
        data: {
          product: 'nim-atlas',
          campaignMode: 'local-first',
          competitiveExpeditions: false,
          walletRequired: false,
          curriculumVersion: 1,
        },
      },
    });
  });

  it('keeps wallet orders and writes unavailable in the static preview', async () => {
    await expect(previewAtlasResponse('orders', 'POST')).resolves.toEqual({
      status: 503,
      body: { ok: false, error: 'Atlas preview is read-only.' },
    });
  });
});
