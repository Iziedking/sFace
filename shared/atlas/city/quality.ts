import type { AtlasQualityTier } from './types';

export type { AtlasQualityTier } from './types';

export interface AtlasQualityProfile {
  readonly tier: AtlasQualityTier;
  readonly visibleNpcs: number;
  readonly activeNpcs: number;
  readonly renderScale: number;
  readonly particles: boolean;
  readonly shadows: 'off' | 'contact' | 'dynamic';
  readonly farNpcLod: 1 | 2;
  readonly farAnimationEveryTicks: number;
}

export const QUALITY_PROFILES: Readonly<Record<AtlasQualityTier, AtlasQualityProfile>> = Object.freeze({
  low: Object.freeze({
    tier: 'low',
    visibleNpcs: 8,
    activeNpcs: 4,
    renderScale: 0.7,
    particles: false,
    shadows: 'off',
    farNpcLod: 2,
    farAnimationEveryTicks: 30,
  }),
  balanced: Object.freeze({
    tier: 'balanced',
    visibleNpcs: 12,
    activeNpcs: 6,
    renderScale: 0.85,
    particles: false,
    shadows: 'contact',
    farNpcLod: 2,
    farAnimationEveryTicks: 30,
  }),
  high: Object.freeze({
    tier: 'high',
    visibleNpcs: 17,
    activeNpcs: 10,
    renderScale: 1,
    particles: true,
    shadows: 'dynamic',
    farNpcLod: 1,
    farAnimationEveryTicks: 30,
  }),
});

export const QUALITY_REDUCTION_ORDER = [
  'particles',
  'shadows',
  'far-npc-lod',
  'far-animation-rate',
  'render-scale',
] as const;

export interface AtlasQualityGovernor {
  current(): AtlasQualityTier;
  sample(frameTimeMs: number): void;
  setManualTier(tier: AtlasQualityTier | null): void;
}

const SLOW_FRAME_MS = 34;
const STABLE_FRAME_MS = 30;
const SLOW_SECONDS_TO_STEP_DOWN = 5;
const STABLE_SECONDS_TO_STEP_UP = 30;
const TIER_COOLDOWN_SECONDS = 10;
const TIER_ORDER: readonly AtlasQualityTier[] = ['low', 'balanced', 'high'];

export function createQualityGovernor(initialTier: AtlasQualityTier = 'balanced'): AtlasQualityGovernor {
  let tier = initialTier;
  let manualTier: AtlasQualityTier | null = null;
  let slowSeconds = 0;
  let stableSeconds = 0;
  let cooldownSeconds = 0;

  return {
    current: () => tier,
    sample(frameTimeMs: number): void {
      if (manualTier !== null || !Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return;
      cooldownSeconds = Math.max(0, cooldownSeconds - 1);
      if (frameTimeMs > SLOW_FRAME_MS) {
        slowSeconds += 1;
        stableSeconds = 0;
        if (slowSeconds >= SLOW_SECONDS_TO_STEP_DOWN && cooldownSeconds === 0) {
          tier = stepTier(tier, -1);
          slowSeconds = 0;
          cooldownSeconds = TIER_COOLDOWN_SECONDS;
        }
        return;
      }
      if (frameTimeMs <= STABLE_FRAME_MS) {
        stableSeconds += 1;
        slowSeconds = 0;
        if (stableSeconds >= STABLE_SECONDS_TO_STEP_UP && cooldownSeconds === 0) {
          tier = stepTier(tier, 1);
          stableSeconds = 0;
          cooldownSeconds = TIER_COOLDOWN_SECONDS;
        }
        return;
      }
      slowSeconds = 0;
      stableSeconds = 0;
    },
    setManualTier(nextTier: AtlasQualityTier | null): void {
      manualTier = nextTier;
      if (nextTier !== null) tier = nextTier;
    },
  };
}

function stepTier(tier: AtlasQualityTier, direction: -1 | 1): AtlasQualityTier {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, index + direction))];
}
