import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Sface production server image', () => {
  it('copies shared server imports into the runtime image', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toContain('COPY shared ./shared');
  });
});
