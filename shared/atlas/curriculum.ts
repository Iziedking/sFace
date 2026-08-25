import { z } from 'zod';

import type { AtlasCurriculum } from './types';

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const reviewedAt = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const districtId = z.enum(['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city']);
const operation = z.enum([
  'nim-luna-convert', 'validate-address', 'provider-init', 'consensus-status', 'block-number', 'list-accounts', 'sign-challenge',
  'prepare-basic-payment', 'inspect-transaction-receipt', 'explain-confirmations', 'inspect-validator', 'prepare-delegation',
  'send-testnet-payment', 'map-provider-capabilities', 'compose-mini-app-flow', 'install-beacon-component',
  'send-mainnet-payment',
]);
const capability = z.enum(['local', 'provider-read', 'wallet-sign', 'server-read', 'testnet-send', 'mainnet-send']);

const source = z.object({
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'nimiq.dev' || url.hostname === 'www.nimiq.dev');
  }, 'Curriculum sources must use the official Nimiq developer site.'),
  title: z.string().min(3).max(120),
  reviewedAt,
}).strict();

const trial = z.object({
  id,
  title: z.string().min(3).max(80),
  objective: z.string().min(10).max(240),
  operation,
  capability,
  enabled: z.boolean(),
  ownerGate: z.boolean(),
  source,
  acceptedObservation: z.string().min(3).max(240),
  explanation: z.string().min(10).max(500),
  recipe: z.object({ language: z.literal('typescript'), code: z.string().min(20).max(4_000) }).strict(),
}).strict().superRefine((value, context) => {
  if (value.capability === 'testnet-send' && (value.enabled || !value.ownerGate)) {
    context.addIssue({ code: 'custom', message: 'A testnet send must remain disabled behind an owner gate.' });
  }
  if (value.capability === 'mainnet-send' && (value.enabled || !value.ownerGate)) {
    context.addIssue({ code: 'custom', message: 'A mainnet send must remain disabled behind an owner gate.' });
  }
});

const encounter = z.object({
  id,
  title: z.string().min(3).max(80),
  objective: z.string().min(10).max(240),
  tool: z.enum(['scanner', 'relay-tether', 'shield-pulse']),
  knowledge: z.string().min(10).max(300),
}).strict();

const district = z.object({
  id: districtId,
  title: z.string().min(3).max(80),
  summary: z.string().min(10).max(300),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  encounters: z.array(encounter).min(1).max(12),
  trials: z.array(trial).min(2).max(12),
}).strict();

export const atlasCurriculumSchema = z.object({
  version: z.literal(1),
  reviewedAt,
  districts: z.array(district).length(6),
  finale: z.object({
    id: z.literal('beacon-core'),
    title: z.string().min(3).max(80),
    summary: z.string().min(10).max(300),
    requiredDistricts: z.array(districtId).length(6),
    encounters: z.array(encounter).min(1).max(12),
    trials: z.array(trial).min(1).max(12),
  }).strict(),
  expeditions: z.array(z.object({
    id,
    title: z.string().min(3).max(80),
    districtIds: z.array(districtId).min(1).max(6),
    lessonTrialIds: z.array(id).min(1).max(12),
    ruleset: z.literal('atlas-expedition-1'),
  }).strict()).length(3),
}).strict().superRefine((value, context) => {
  const districtIds = value.districts.map((item) => item.id);
  if (new Set(districtIds).size !== districtIds.length) context.addIssue({ code: 'custom', message: 'District ids must be unique.' });
  const trialIds = [...value.districts.flatMap((item) => item.trials), ...value.finale.trials].map((item) => item.id);
  if (new Set(trialIds).size !== trialIds.length) context.addIssue({ code: 'custom', message: 'Trial ids must be unique.' });
  const expeditionIds = value.expeditions.map((item) => item.id);
  if (new Set(expeditionIds).size !== expeditionIds.length) context.addIssue({ code: 'custom', message: 'Expedition ids must be unique.' });
});

export function validateAtlasCurriculum(value: unknown, now = new Date()): AtlasCurriculum {
  const parsed = atlasCurriculumSchema.parse(value) as AtlasCurriculum;
  const sources = [...parsed.districts.flatMap((districtValue) => districtValue.trials), ...parsed.finale.trials].map((item) => item.source);
  const maximumAgeMs = 120 * 24 * 60 * 60 * 1_000;
  for (const item of sources) {
    const reviewed = new Date(`${item.reviewedAt}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(reviewed) || reviewed > now.getTime() || now.getTime() - reviewed > maximumAgeMs) {
      throw new Error(`Curriculum source is stale or future-dated: ${item.url}`);
    }
  }
  return parsed;
}
