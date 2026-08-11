import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('admin token browser handling', () => {
  it('keeps the token out of persistent browser storage and cookies', () => {
    const source = readFileSync(new URL('../src/admin.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('indexedDB');
    expect(source).toContain("cache: 'no-store'");
  });
});
