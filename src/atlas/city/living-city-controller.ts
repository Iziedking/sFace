import type { AtlasLivingWorldSnapshot } from '../../../shared/atlas/living-world';
import { createQualityGovernor } from '../../../shared/atlas/city/quality';
import type { AtlasCitizenPresentation } from '../../../shared/atlas/city/crowd';
import {
  createAtlasCityPlayer,
  cameraRelativeMovement,
  stepAtlasCityPlayer,
  type AtlasCityMovement,
  type AtlasCityPlayerState,
  type AtlasCityWalkBounds,
} from '../../../shared/atlas/city/player';
import type { AtlasCityCollider } from '../../../shared/atlas/city/types';
import { ATLAS_DISTRICT_WORLDS } from '../../../shared/atlas/districts/registry';
import { directAtlasMission, type AtlasMissionBeat, type AtlasMissionProgress } from '../../../shared/atlas/mission-director';
import type { AtlasCityInteractionPresentation } from '../render/contracts';
import { AtlasCrowdController } from './crowd-controller';

export interface AtlasLivingCityRenderer {
  loadDistrict(districtId: string): Promise<void>;
  releaseDistrict(districtId: string): Promise<void>;
  render(snapshot: AtlasLivingWorldSnapshot, crowd?: readonly AtlasCitizenPresentation[], player?: AtlasCityPlayerState, interaction?: AtlasCityInteractionPresentation): void;
  resize(width: number, height: number, resolution: number): void;
  setQuality?(tier: 'low' | 'balanced' | 'high'): void;
  stats?(): { readonly drawCalls: number; readonly triangles: number };
  destroy(): Promise<void>;
}

export interface AtlasLivingCityFrameLoop {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

export interface AtlasLivingCityOptions {
  readonly renderer: AtlasLivingCityRenderer;
  readonly frameLoop?: AtlasLivingCityFrameLoop;
  readonly daySeed?: string;
  readonly sampleMovement?: () => AtlasCityMovement;
  readonly onFrame?: (frame: { readonly player: AtlasCityPlayerState; readonly qualityTier: 'low' | 'balanced' | 'high' }) => void;
  readonly navigation?: AtlasLivingCityNavigation;
  /*
   * A camera heading to hold instead of following the player, or null to follow
   * as normal. The welcome screen uses it to drift slowly over the harbour; the
   * play screens never set it. Returning a number here is the whole of the
   * orbit: the rig already accepts cameraHeadingRadians, so no camera mode and
   * no renderer change is involved.
   */
  readonly idleHeading?: () => number | null;
}

export interface AtlasLivingCityNavigation {
  readonly initial: Pick<AtlasCityPlayerState, 'x' | 'z' | 'facing'>;
  readonly bounds: AtlasCityWalkBounds;
  readonly colliders?: readonly AtlasCityCollider[];
  readonly cameraHeadingRadians?: number;
}

const DEFAULT_NAVIGATION: AtlasLivingCityNavigation = {
  initial: { x: 0, z: 4.2, facing: 'up' },
  bounds: { minX: -10, maxX: 10, minZ: -18, maxZ: 6 },
};


export class AtlasLivingCityController {
  private readonly frameLoop: AtlasLivingCityFrameLoop;
  private readonly quality = createQualityGovernor('balanced');
  private readonly crowd = new AtlasCrowdController();
  private frameHandle: number | null = null;
  private currentDistrict: string | null = null;
  private destroyed = false;
  private snapshot: AtlasLivingWorldSnapshot | null = null;
  private lastFrameTimestamp: number | null = null;
  private navigation: AtlasLivingCityNavigation;
  private player: AtlasCityPlayerState;
  private cityTick = 0;
  private daySeed: string;
  private cameraControlActive = false;
  private secondsSinceCameraInput = Number.POSITIVE_INFINITY;
  private secondsSinceMovement = 0;
  private sustainedMovementSeconds = 0;
  private interactionPresentation: AtlasCityInteractionPresentation | undefined;
  private missionProgress: AtlasMissionProgress = { reachedNeed: false, attempted: false, evidenceGathered: false, installed: false, taughtBack: false };
  private currentBeat: AtlasMissionBeat | null = null;

  constructor(private readonly options: AtlasLivingCityOptions) {
    this.frameLoop = options.frameLoop ?? browserFrameLoop();
    this.navigation = options.navigation ?? DEFAULT_NAVIGATION;
    this.player = createAtlasCityPlayer(this.navigation.initial);
    this.player = { ...this.player, cameraHeadingRadians: this.navigation.cameraHeadingRadians ?? this.player.cameraHeadingRadians };
    this.daySeed = options.daySeed ?? 'day-0';
  }

  start(): void {
    if (this.destroyed || this.frameHandle !== null) return;
    this.lastFrameTimestamp = null;
    this.frameHandle = this.frameLoop.request(this.frame);
  }

  async activateDistrict(districtId: string): Promise<void> {
    if (this.destroyed) throw new Error('Atlas living city controller is destroyed.');
    const previous = this.currentDistrict;
    await this.options.renderer.loadDistrict(districtId);
    if (previous && previous !== districtId) await this.options.renderer.releaseDistrict(previous);
    this.currentDistrict = districtId;
  }

  present(snapshot: AtlasLivingWorldSnapshot, daySeed: string = this.options.daySeed ?? 'day-0'): void {
    if (this.destroyed) return;
    this.snapshot = snapshot;
    this.daySeed = daySeed;
    this.refreshCrowd(snapshot.simulation.tick);
    this.refreshBeat();
  }

  /**
   * The beat this district is on, or null when no district is presented.
   *
   * The controller asks the director rather than deciding. Three renderers
   * share this layer and the verification service replays the director, so a
   * beat chosen here would be a beat the service could not reproduce.
   */
  beat(): AtlasMissionBeat | null {
    return this.currentBeat;
  }

  /**
   * Progress only ever moves forward. If a flag could go back to false, a
   * player could replay the refusal to skip the evidence step, and the
   * teach-back is the one thing the verification service actually checks.
   */
  advance(progress: Partial<AtlasMissionProgress>): void {
    if (this.destroyed) return;
    this.missionProgress = {
      reachedNeed: this.missionProgress.reachedNeed || progress.reachedNeed === true,
      attempted: this.missionProgress.attempted || progress.attempted === true,
      evidenceGathered: this.missionProgress.evidenceGathered || progress.evidenceGathered === true,
      installed: this.missionProgress.installed || progress.installed === true,
      taughtBack: this.missionProgress.taughtBack || progress.taughtBack === true,
    };
    this.refreshBeat();
  }

  setInteractionPresentation(presentation: AtlasCityInteractionPresentation | undefined): void {
    if (this.destroyed) return;
    this.interactionPresentation = presentation;
  }

  setNavigation(navigation: AtlasLivingCityNavigation): void {
    if (this.destroyed) return;
    this.navigation = navigation;
    this.player = createAtlasCityPlayer(navigation.initial);
    this.player = { ...this.player, cameraHeadingRadians: navigation.cameraHeadingRadians ?? this.player.cameraHeadingRadians };
  }

  playerSnapshot(): AtlasCityPlayerState {
    return { ...this.player };
  }

  orbitCamera(deltaRadians: number): void {
    if (this.destroyed || !Number.isFinite(deltaRadians)) return;
    this.player = {
      ...this.player,
      cameraHeadingRadians: normalizeAngle(this.player.cameraHeadingRadians + deltaRadians),
    };
    this.secondsSinceCameraInput = 0;
    this.sustainedMovementSeconds = 0;
  }

  setCameraControlActive(active: boolean): void {
    if (this.destroyed) return;
    this.cameraControlActive = active;
    if (active) this.secondsSinceCameraInput = 0;
  }

  recenterCamera(): void {
    if (this.destroyed) return;
    this.player = { ...this.player, cameraHeadingRadians: this.player.headingRadians };
    this.secondsSinceMovement = 0;
  }

  resize(width: number, height: number, resolution: number): void {
    if (!this.destroyed) this.options.renderer.resize(width, height, resolution);
  }

  recordFrameTime(milliseconds: number): void {
    const previous = this.quality.current();
    this.quality.sample(milliseconds);
    const next = this.quality.current();
    if (next !== previous) {
      this.options.renderer.setQuality?.(next);
      this.refreshCrowd(this.cityTick);
    }
  }

  qualityTier(): 'low' | 'balanced' | 'high' {
    return this.quality.current();
  }

  crowdSnapshot() {
    return this.crowd.snapshot();
  }

  stats() {
    return this.options.renderer.stats?.() ?? { drawCalls: 0, triangles: 0 };
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frameHandle !== null) this.frameLoop.cancel(this.frameHandle);
    this.frameHandle = null;
    this.lastFrameTimestamp = null;
    if (this.currentDistrict) await this.options.renderer.releaseDistrict(this.currentDistrict);
    this.currentDistrict = null;
    this.snapshot = null;
    this.cityTick = 0;
    await this.options.renderer.destroy();
  }

  private frame = (timestamp: number): void => {
    this.frameHandle = null;
    if (this.destroyed) return;
    const elapsedMilliseconds = this.lastFrameTimestamp === null ? 1_000 / 30 : Math.max(1, timestamp - this.lastFrameTimestamp);
    if (this.lastFrameTimestamp !== null) this.recordFrameTime(elapsedMilliseconds);
    this.lastFrameTimestamp = timestamp;
    const deltaSeconds = elapsedMilliseconds / 1_000;
    const idleHeading = this.options.idleHeading?.() ?? null;
    if (idleHeading !== null) this.player = { ...this.player, cameraHeadingRadians: idleHeading };
    const sampledMovement = this.options.sampleMovement?.() ?? { moveX: 0, moveY: 0 };
    const movement = cameraRelativeMovement(sampledMovement, this.player.cameraHeadingRadians);
    this.player = stepAtlasCityPlayer(
      this.player,
      movement,
      deltaSeconds,
      this.navigation.bounds,
      this.navigation.colliders,
      this.navigation.initial,
    );
    this.updateCameraFollow(deltaSeconds);
    this.cityTick += Math.max(1, Math.round(elapsedMilliseconds / (1_000 / 30)));
    if (this.snapshot) {
      const frameSnapshot: AtlasLivingWorldSnapshot = {
        ...this.snapshot,
        simulation: { ...this.snapshot.simulation, tick: this.cityTick },
      };
      this.options.renderer.render(frameSnapshot, this.crowd.snapshot(), this.player, this.interactionPresentation);
    }
    this.options.onFrame?.({ player: { ...this.player }, qualityTier: this.quality.current() });
    this.frameHandle = this.frameLoop.request(this.frame);
  };

  private refreshBeat(): void {
    const snapshot = this.snapshot;
    if (!snapshot) {
      this.currentBeat = null;
      return;
    }
    // The world is looked up by the snapshot's own district id rather than
    // being passed in, so present() keeps its existing signature and no caller
    // has to learn about chapters to show one.
    const world = ATLAS_DISTRICT_WORLDS.find((candidate) => candidate.districtId === snapshot.districtId);
    this.currentBeat = world ? directAtlasMission(world.chapter, snapshot, this.player, this.missionProgress) : null;
  }

  private refreshCrowd(tick: number): void {
    if (!this.snapshot) return;
    this.crowd.update(this.currentDistrict ?? 'beacon-commons', this.daySeed, this.snapshot.restoration, this.quality.current(), tick);
  }

  /*
   * Camera heading is the player's to set.
   *
   * This used to swing the camera behind the player on its own: 0.65 s after
   * movement stopped it damped the heading back to the player's facing. Because
   * movement is camera-relative, that meant the direction the stick pointed kept
   * changing while the player stood still deciding what to do, which playtested
   * as the view moving on its own and the controls not being trustworthy.
   *
   * Recentring is still one tap away on the Center button, which is where a
   * player asks for it deliberately. All that is tracked here now is how long
   * the camera has been untouched, which the HUD uses.
   */
  private updateCameraFollow(deltaSeconds: number): void {
    if (this.cameraControlActive) {
      this.secondsSinceCameraInput = 0;
      return;
    }
    this.secondsSinceCameraInput += deltaSeconds;
    this.secondsSinceMovement = this.player.moving ? 0 : this.secondsSinceMovement + deltaSeconds;
    this.sustainedMovementSeconds = this.player.moving ? this.sustainedMovementSeconds + deltaSeconds : 0;
  }
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}



function browserFrameLoop(): AtlasLivingCityFrameLoop {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}
