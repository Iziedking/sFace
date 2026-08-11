import { describe, expect, it } from 'vitest';

import { validateConfigChange } from '../server/admin/config-store';

describe('admin configuration changes', () => {
  it('accepts registered non-secret values as restart-pending', () => {
    expect(validateConfigChange('TRUST_PROXY', 'true')).toEqual({ ok: true, key: 'TRUST_PROXY', value: 'true', restartRequired: true });
    expect(validateConfigChange('ADMIN_ALLOWED_IPS', '127.0.0.1')).toEqual({ ok: true, key: 'ADMIN_ALLOWED_IPS', value: '127.0.0.1', restartRequired: true });
  });

  it('refuses unknown and secret keys', () => {
    expect(validateConfigChange('NOPE', 'x')).toEqual({ ok: false, error: 'unknown_key' });
    expect(validateConfigChange('ADMIN_TOKEN', 'x')).toEqual({ ok: false, error: 'secret_key_requires_replacement' });
  });
});
