/**
 * Fetching today's mission.
 *
 * ## Why this is not in game/mission.ts
 *
 * It used to be, and that broke the entire premise of the game on the live site
 * without a single error anywhere.
 *
 * game/mission.ts is shared with the service, which rebuilds a level from a seed
 * to bound a submitted score. So it has to be importable from Node, which means
 * it cannot touch `import.meta.env` at module scope. The workaround was to read
 * it lazily inside a function, through a widened local:
 *
 *     const meta = import.meta as ImportMeta & { env?: ... };
 *     return meta.env?.VITE_API_BASE ?? '';
 *
 * That typechecks under both projects and is completely dead code. Vite's env
 * substitution is TEXTUAL: it fires on the literal `import.meta.env.VITE_...`
 * and nothing else. Aliasing `import.meta` to a variable first means the scanner
 * never sees it, so the expression ships to the browser untouched, where
 * `import.meta.env` is not a real property. The optional chain then short
 * circuits to undefined, the base comes back empty, and `loadMission` quietly
 * takes its "no service configured" path.
 *
 * The result on production: every visitor got a synthetic practice chart instead
 * of the day's actual worst performer, while the leaderboard and profile calls
 * worked fine, because those modules read the literal at module scope and were
 * substituted correctly. The game's whole premise was dead and nothing logged a
 * word about it.
 *
 * So the network half lives here, in a client-only module, where the literal is
 * safe at module scope exactly as it is in the other net modules. game/mission
 * .ts goes back to being types, parsing and the fallback: all Node-safe, with
 * nothing in it that a bundler has to rewrite.
 *
 * The rule this file exists to enforce: never read a VITE_ variable through
 * anything but the literal `import.meta.env.NAME`, and never from a module the
 * service imports.
 */

import { parseMission, practiceMission, type DailyMission } from '../game/mission';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface MissionLoad {
  mission: DailyMission;
  /** Set when we fell back, so the brief screen can say so plainly. */
  notice: string | null;
}

/**
 * Fetch today's mission. Never rejects: a run must always be startable, because
 * the alternative is a judge staring at a spinner.
 */
export async function loadMission(signal?: AbortSignal): Promise<MissionLoad> {
  /*
   * No service configured. Fall back silently.
   *
   * There used to be a banner here saying so, and it was redundant: a practice
   * mission already announces itself everywhere it matters. The ticker strip
   * reads PRACTICE instead of a percentage, the brief says PRACTICE MISSION on
   * the card, and the score card carries it too. A pink notice on top of that
   * was the same fact a fourth time, in the loudest possible voice, on the
   * first screen anybody sees.
   *
   * The state is still labelled. It is just no longer shouted.
   */
  if (!API_BASE) {
    return { mission: practiceMission(), notice: null };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    const response = await fetch(`${API_BASE}/mission/today`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`mission ${response.status}`);

    const mission = parseMission(await response.json());
    if (!mission) throw new Error('mission payload failed validation');

    return { mission, notice: null };
  } catch {
    return {
      mission: practiceMission(),
      notice: 'Could not reach the market. This is a practice mission.',
    };
  }
}
