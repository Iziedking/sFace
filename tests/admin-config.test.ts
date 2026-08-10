import { describe, expect, it } from 'vitest';

import { configInventory } from '../server/admin/config';

describe('admin configuration inventory', () => {
  it('reports presence without returning secret values', () => {
    const entries = configInventory({ ADMIN_TOKEN: 'secret', GIT_COMMIT: 'abc' });
    expect(entries.find((entry) => entry.key === 'ADMIN_TOKEN')).toEqual({ key: 'ADMIN_TOKEN', configured: true, secret: true, restartRequired: true });
    expect(JSON.stringify(entries)).not.toContain('secret');
  });
});
