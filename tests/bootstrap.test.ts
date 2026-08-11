import { describe, expect, it } from 'vitest';

import { mergeStartupConfig } from '../server/bootstrap';

describe('restart bootstrap configuration', () => {
  it('applies only registered pending values and leaves unrelated env intact', () => {
    expect(mergeStartupConfig({ PORT: '8790' }, { ALLOWED_ORIGINS: 'https://sface.site', ADMIN_ALLOWED_IPS: '127.0.0.1', NOPE: 'bad' })).toEqual({
      PORT: '8790',
      ALLOWED_ORIGINS: 'https://sface.site',
      ADMIN_ALLOWED_IPS: '127.0.0.1',
    });
  });
});
