import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const threeRenderer = readFileSync(new URL('../src/atlas/render/three/three-renderer.ts', import.meta.url), 'utf8');
const beaconScene = JSON.parse(readFileSync(new URL('../public/atlas/3d/v1/beacon-commons/scene.json', import.meta.url), 'utf8')) as { anchors: Array<{ id: string; position: [number, number, number] }>; colliders: Array<{ id: string; position: [number, number, number]; size: [number, number, number] }> };

describe('approved living-city game entry', () => {
  it('routes the former Genesis continuation into the full-screen living city', () => {
    expect(app).toContain("private startGarden = (): void => this.openBeaconCommons();");
    expect(app).not.toContain('this.renderer.draw(this.state, objective)');
    expect(app).not.toContain('cityViewport.append(this.livingCityHost)');
  });

  it('renders the city as the game shell rather than a menu card', () => {
    expect(app).toContain('atlas-living-city-play-shell');
    expect(app).toContain('this.createCityJoystick()');
    expect(app).toContain('this.createCameraLookZone()');
    expect(app).toContain('atlas-camera-look-zone');
    expect(app).toContain('orbitCamera');
    expect(app).toContain('atlas-joystick-thumb');
    expect(app).toContain('MEET THE COMMONS GUIDE');
    expect(css).toContain('.atlas-living-city-play-shell');
    // Was '#atlas-city-stage.is-playing'. The stage no longer waits to be
    // switched on for two of the nine screens: it carries its ground from boot,
    // which is a stronger form of the property this line was asserting.
    expect(css).toContain('#atlas-city-stage { position: fixed');
    expect(css).toContain('background: var(--atlas-city-ground)');
    // No rule may still be gated on it. The comment explaining why it went is
    // prose, not a selector, so this matches a rule opening rather than the word.
    expect(css).not.toMatch(/\.is-playing\s*(?:::[a-z-]+)?\s*\{/);
    expect(css).toContain('border-radius: 50%');
    expect(css).toContain('.atlas-camera-look-zone');
    expect(css).toContain('.atlas-city-waypoint');
    expect(app).toContain('${activeCitizens} ACTIVE');
    expect(app).not.toContain('${activeCitizens} MOVING');
  });

  it('keeps the mission HUD on the palette rather than a slab of its own', () => {
    // This used to assert the surface was cream at .96, because the product was
    // ink on warm paper. It is now translucent dark glass over a live city, so
    // the light-surface intent is gone deliberately. What still matters, and is
    // what the assertion was protecting all along, is that the HUD takes its
    // surface and its text from tokens instead of hardcoding a panel colour.
    expect(css).toMatch(/--atlas-mission-surface: rgb\(var\(--atlas-paper-rgb\) \/ \.9\)/);
    expect(css).toContain('background: var(--atlas-mission-surface)');
    expect(css).toContain('color: var(--atlas-ink)');
    const outsideRoot = css.replace(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1), '');
    expect(outsideRoot).not.toMatch(/background:\s*rgba?\(\s*\d/);
  });

  it('streams Pay Harbor into the same playable 3D runtime', () => {
    expect(app).toContain("await controller.activateDistrict('pay-harbor')");
    expect(app).toContain('private renderPayHarbor(): void');
    expect(app).toContain('projectPayHarborPhysicalMission');
    expect(app).toContain('this.presentPayHarborWorld()');
    expect(app).toContain('createCityWaypoint');
    expect(app).toContain('getAtlasWaypointGuidance');
    // Citizens pick a path by name, fall back to a slot-indexed one, and prefer the
    // collision-routed version of whichever they land on. Asserted as three separate
    // facts rather than one exact expression, because the previous single-string match
    // went stale the moment routed paths were added and the suite went red on an
    // improvement rather than on a regression.
    expect(threeRenderer).toContain('this.districtScene.paths.find((candidate) => candidate.id === citizen.pathId)');
    expect(threeRenderer).toContain('this.districtScene.paths[slotIndex % this.districtScene.paths.length]');
    expect(threeRenderer).toContain('this.routedPaths.get(namedPath.id)');
    expect(threeRenderer).toContain('this.presentRestorationLights(snapshot.restoration, snapshot.simulation.tick)');
    expect(threeRenderer).toContain('atlas-builder-relay-handheld');
    expect(threeRenderer).toContain('findAttachmentSocket');
    expect(threeRenderer).toContain('atlas-builder-station-${anchor.id}');
    expect(threeRenderer).toContain('const districtCrowd = BEACON_COMMONS_CROWD.filter((citizen) => npcAnchors.has(citizen.spawnAnchorId))');
    expect(threeRenderer).toContain('const mast = new Mesh');
    expect(threeRenderer).toContain('station.beam.visible = complete || active');
    // The colour moved into src/atlas/palette.ts; what this line guards is the
    // conditional, not the literal. atlas-palette.test.ts asserts no renderer
    // carries a colour of its own.
    expect(threeRenderer).toContain('completedStations > 0 ? ATLAS_WORLD_PALETTE.lanternComplete');
    expect(threeRenderer).toContain('const PLAYER_WORLD_SCALE = 0.46');
    expect(threeRenderer).toContain('const NPC_WORLD_SCALE = 0.38');
    expect(threeRenderer).toContain('presentMissionMarker');
    expect(threeRenderer).toContain('createHarborActivityVisuals');
    expect(threeRenderer).toContain('presentHarborActivity');
    expect(app).toContain('relayCarried: this.selectedRole === \'builder\' && this.lanternState.phase === \'fulfilled\'');
  });

  it('places the Pay Harbor gate marker outside the transport building collider', () => {
    const gate = beaconScene.anchors.find((anchor) => anchor.id === 'travel-pay-harbor')!;
    const building = beaconScene.colliders.find((collider) => collider.id === 'obstruction-transit')!;
    const northCollisionEdge = building.position[2] + building.size[2] / 2 + 0.34;
    expect(gate.position[2]).toBeGreaterThan(northCollisionEdge);
  });
});
