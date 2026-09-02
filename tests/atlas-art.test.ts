import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assets = [
  { id: 'avatar-sheet', path: 'art/atlas/characters/avatar-sheet.png' },
  { id: 'mara-sheet', path: 'art/atlas/characters/mara-sheet.png' },
  { id: 'pay-harbor-board', path: 'art/atlas/environments/pay-harbor-board.png' },
];

const vectorSources = [
  { id: 'avatar-vector-source', path: 'art/atlas/characters/avatar-key-art.svg' },
  { id: 'mara-vector-source', path: 'art/atlas/characters/mara-key-art.svg' },
  { id: 'pay-harbor-vector-source', path: 'art/atlas/environments/pay-harbor-layout.svg' },
];

describe('Atlas art provenance', () => {
  it('ships original art files with explicit provenance before production conversion', () => {
    const licenses = JSON.parse(readFileSync('art/atlas/licenses.json', 'utf8')) as Array<Record<string, unknown>>;
    for (const asset of assets) {
      expect(existsSync(asset.path)).toBe(true);
      const record = licenses.find((item) => item.id === asset.id);
      expect(record).toMatchObject({
        id: asset.id,
        authorOrTool: expect.any(String),
        creationDate: expect.any(String),
        sourceFile: asset.path,
        license: expect.any(String),
        consentStatus: expect.any(String),
        realPersonLikeness: false,
        approvedDerivativeUse: false,
        status: 'rejected-reference',
      });
    }
  });

  it('uses editable vector source art for the non-generated approval direction', () => {
    const licenses = JSON.parse(readFileSync('art/atlas/licenses.json', 'utf8')) as Array<Record<string, unknown>>;
    for (const asset of vectorSources) {
      expect(existsSync(asset.path)).toBe(true);
      expect(licenses.find((item) => item.id === asset.id)).toMatchObject({
        id: asset.id,
        sourceFile: asset.path,
        editableSource: true,
        rasterGeneration: false,
        realPersonLikeness: false,
        status: 'owner-approval-candidate',
      });
    }
  });
});
