import type { AtlasCityPlayerState } from './city/player';
import type { AtlasCascadeScale, AtlasLivingWorldChapter, AtlasLivingWorldSnapshot } from './living-world';
import type { AtlasDistrictId } from './types';

/**
 * Decides which beat a district is on.
 *
 * The second consumer of this module is the verification service, which
 * replays a recorded district run through this same function to confirm a
 * teach-back was earned rather than skipped. That is why the constraint here
 * is "no DOM, no canvas, no fetch, no clock" rather than "keep this pure": the
 * first is something anyone can check by reading the imports, and the second
 * is a preference that erodes the first time a deadline arrives.
 *
 * The renderers never decide a beat. There are three of them, three.js, pixi
 * and canvas, because the device floor is a low-end Android in a WebView. A
 * curriculum that lived in the renderer would be a curriculum that quietly
 * differed per device, and the whole point of the cascade is that every player
 * gets the same seven lessons in the same order.
 */
export type AtlasMissionBeatKind = 'arrive' | 'witness' | 'refused' | 'gather' | 'install' | 'teach-back';

export interface AtlasMissionProgress {
  readonly reachedNeed: boolean;
  readonly attempted: boolean;
  readonly evidenceGathered: boolean;
  readonly installed: boolean;
  readonly taughtBack: boolean;
}

export interface AtlasMissionBeat {
  readonly kind: AtlasMissionBeatKind;
  readonly scale: AtlasCascadeScale;
  readonly districtId: AtlasDistrictId;
  readonly headline: string;
  readonly detail: string;
  readonly refusalReason: string | null;
}

export function directAtlasMission(
  chapter: AtlasLivingWorldChapter,
  snapshot: AtlasLivingWorldSnapshot,
  player: AtlasCityPlayerState,
  progress: AtlasMissionProgress,
): AtlasMissionBeat {
  if (!Number.isFinite(player.x) || !Number.isFinite(player.z)) throw new Error('Atlas mission director received a malformed player position.');
  return describeBeat(chapter, snapshot, kindFor(snapshot, progress));
}

function kindFor(snapshot: AtlasLivingWorldSnapshot, progress: AtlasMissionProgress): AtlasMissionBeatKind {
  if (progress.installed) return 'teach-back';
  if (!progress.reachedNeed) return 'arrive';
  if (!progress.attempted) return 'witness';
  // The refusal is the load-bearing beat. The player tries the thing the world
  // appears to accept, and the world declines using this district's own
  // refutation. Evidence is only offered afterwards, so the lesson arrives
  // before its answer does. Reversing those two turns a lesson into an errand.
  if (!progress.evidenceGathered) return 'refused';
  return snapshot.restoration === 'restored' ? 'install' : 'gather';
}

function describeBeat(chapter: AtlasLivingWorldChapter, snapshot: AtlasLivingWorldSnapshot, kind: AtlasMissionBeatKind): AtlasMissionBeat {
  const base = { kind, scale: chapter.scale, districtId: snapshot.districtId, refusalReason: null } as const;
  switch (kind) {
    case 'arrive':
      return { ...base, headline: 'Find who needs this route', detail: chapter.humanNeed };
    case 'witness':
      return { ...base, headline: chapter.humanNeed, detail: chapter.explorerAction };
    case 'refused':
      return { ...base, headline: chapter.claim, detail: chapter.evidence, refusalReason: chapter.refutation };
    case 'gather':
      return { ...base, headline: 'Gather what actually settles it', detail: chapter.evidence };
    case 'install':
      return { ...base, headline: chapter.installation, detail: chapter.proof };
    case 'teach-back':
      return { ...base, headline: 'Teach it back', detail: chapter.teachBack };
    default: {
      const unreachable: never = kind;
      throw new Error(`Atlas mission beat is unhandled: ${String(unreachable)}`);
    }
  }
}

/**
 * One beat, flattened into the rows a panel shows, in reading order.
 *
 * This lives beside the beat rather than in the UI because there is no DOM in
 * the test environment, and a panel whose only test is "does the source string
 * contain this class name" is the brittle pattern that already broke this
 * repository once. The rows are the part worth asserting, so they are pure and
 * the DOM adapter over them stays thin enough to read.
 */
export type AtlasBeatRowKind = 'headline' | 'refusal' | 'detail';

export interface AtlasBeatRow {
  readonly kind: AtlasBeatRowKind;
  readonly text: string;
  /** True where the product already uses monospace: anything a player can go and check. */
  readonly monospace: boolean;
}

export function atlasBeatRows(beat: AtlasMissionBeat): readonly AtlasBeatRow[] {
  const rows: AtlasBeatRow[] = [{ kind: 'headline', text: beat.headline, monospace: false }];
  if (beat.refusalReason !== null) rows.push({ kind: 'refusal', text: beat.refusalReason, monospace: true });
  rows.push({ kind: 'detail', text: beat.detail, monospace: false });
  return rows;
}
