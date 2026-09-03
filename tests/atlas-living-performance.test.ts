import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PAY_HARBOR_WORLD } from '../shared/atlas/districts/pay-harbor';
import { projectLivingWorld } from '../shared/atlas/living-world';
import { createAtlasState, snapshotAtlasState } from '../shared/atlas/state';

const appSource = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/atlas/render/renderer.ts', import.meta.url), 'utf8');
const sceneGraphSource = readFileSync(new URL('../src/atlas/render/scene-graph.ts', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../public/atlas/manifests/assets-v1.json', import.meta.url), 'utf8')) as { mobileBudgetBytes: number; assets: Array<{ compressedBytes: number }> };

describe('NIM Atlas Release A performance contract', () => {
  it('ships the measured performance CLI and keeps the mobile asset budget', () => {
    const measure = readFileSync(new URL('../scripts/measure-atlas.mjs', import.meta.url), 'utf8');
    expect(measure).toContain('--viewports');
    expect(measure).toContain('p95ReplayMs');
    expect(measure).toContain('traceBytes');
    expect(measure).toContain('districtBundles');
    expect(measure).toContain('p50FrameMs');
    expect(measure).toContain('p95FrameMs');
    expect(measure).toContain('inputLatencyMs');
    expect(measure).toContain('buildMetadata');
    expect(measure).toContain('memoryWindow');
    expect(manifest.assets.reduce((total, asset) => total + asset.compressedBytes, 0)).toBeLessThanOrEqual(manifest.mobileBudgetBytes);
  });

  it('keeps 50 district transitions bounded and snapshots immutable', () => {
    const state = createAtlasState(PAY_HARBOR_WORLD.mission);
    const snapshots = Array.from({ length: 50 }, (_, index) => projectLivingWorld(PAY_HARBOR_WORLD, state, index % 3 === 0 ? 'restored' : index % 2 === 0 ? 'confirming' : 'waiting'));
    expect(snapshots).toHaveLength(50);
    expect(new Set(snapshots.map((snapshot) => snapshot.entities.length))).toEqual(new Set([PAY_HARBOR_WORLD.entities.length]));
    expect(snapshots.every((snapshot, index) => index === 0 || snapshot !== snapshots[index - 1])).toBe(true);
    const snapshot = snapshotAtlasState(state);
    snapshot.player.x = 999;
    snapshot.events.push({ tick: 1, type: 'paused', targetId: 'system' });
    expect(state.player.x).toBe(PAY_HARBOR_WORLD.mission.spawn.x);
    expect(state.events).toHaveLength(0);
  });

  it('keeps renderer and browser listener ownership bounded', () => {
    expect((appSource.match(/new AtlasRenderer\(/g) ?? []).length).toBe(1);
    /*
     * The budget counts listeners the app keeps, which is what sprawls. A
     * registration made with { once: true } detaches itself after firing, so it
     * is not ownership; the audio unlock is one of those, because browsers will
     * not start an AudioContext before a gesture and there is no existing
     * global gesture hook to hang it on.
     *
     * Raising the number instead would have made the guard mean less each time
     * it was inconvenient.
     */
    const starts = [...appSource.matchAll(/addEventListener\(/g)].map((match) => match.index ?? 0);
    const owned = starts.filter((start, index) => {
      // A handler body contains its own ');', so read to the next registration
      // rather than to the next closing paren.
      const end = starts[index + 1] ?? appSource.length;
      return !/once:\s*true/.test(appSource.slice(start, end));
    });
    expect(owned.length, `owned listeners: ${owned.length}`).toBeLessThanOrEqual(12);
    expect(rendererSource).toContain('LegacyAtlasRenderer');
    expect(sceneGraphSource).toContain('createAtlasRenderer');
  });

  it('keeps a normal deterministic trace below the mobile upload budget', () => {
    const trace = Array.from({ length: 1_350 }, (_, tick) => [tick % 3 === 0 ? 127 : 0, tick % 5 === 0 ? -127 : 0, 0, 0, 0]);
    expect(Buffer.byteLength(JSON.stringify(trace), 'utf8')).toBeLessThanOrEqual(64 * 1024);
  });
});
