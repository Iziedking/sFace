import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const run = readFileSync(new URL('../src/relay/screens/run.ts', import.meta.url), 'utf8');
const world = readFileSync(new URL('../src/relay/render/world.ts', import.meta.url), 'utf8');
const pod = readFileSync(new URL('../src/relay/render/pod.ts', import.meta.url), 'utf8');

describe('Relay first-run clarity', () => {
  it('states the objective and controls in the run HUD', () => {
    expect(run).toContain('Collect orange nodes');
    expect(run).toContain('cross an orange gate to bank them');
    expect(run).toContain('drag left/right to steer');
    expect(run).toContain('Avoid red hazards');
    expect(run).toContain('Move left');
    expect(run).toContain('Center');
    expect(run).toContain('Move right');
  });

  it('labels the visual vocabulary inside the playfield', () => {
    expect(world).toContain('BANK GATE');
    expect(world).toContain('NODE');
    expect(world).toContain('HAZARD');
    expect(pod).toContain('YOU');
  });
});
