import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type ReviewMode = 'city' | 'character';
interface CameraPreset {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

const host = requiredElement('#art-review');

const scene = new Scene();
scene.background = new Color(0xdbe8e3);
scene.fog = new Fog(0xdbe8e3, 28, 54);
scene.add(new AmbientLight(0xfff6e8, 1.65));
const sun = new DirectionalLight(0xffd2ad, 2.15);
sun.position.set(-8, 14, 10);
scene.add(sun);

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
host.append(renderer.domElement);

const camera = new PerspectiveCamera(44, 1, 0.1, 120);
const cityRoot = new Group();
const characterRoot = new Group();
characterRoot.visible = false;
scene.add(cityRoot, characterRoot);

const loader = new GLTFLoader();
const cityUrl = new URL('../../../../art/atlas/environments/beacon-commons-v1/beacon-commons-review-v2.glb', import.meta.url).href;
const characterUrl = new URL('../../../../art/atlas/characters/atlas-walker-v1/atlas-walker-v1.glb', import.meta.url).href;

const [city, character] = await Promise.all([loader.loadAsync(cityUrl), loader.loadAsync(characterUrl)]);
prepare(city.scene);
prepare(character.scene);
cityRoot.add(city.scene);
characterRoot.add(character.scene);

const characterGround = new Mesh(
  new CylinderGeometry(1.25, 1.35, 0.12, 24),
  new MeshLambertMaterial({ color: 0xeadfc8 }),
);
characterGround.position.y = -0.08;
characterRoot.add(characterGround);

let mode: ReviewMode = 'city';
let targetCamera: CameraPreset = cityCamera();

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.addEventListener('click', () => {
    const next = button.dataset.mode;
    if (next !== 'city' && next !== 'character') return;
    mode = next;
    cityRoot.visible = mode === 'city';
    characterRoot.visible = mode === 'character';
    targetCamera = mode === 'city' ? cityCamera() : characterCamera();
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }
  });
}

function prepare(root: Group): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.side = DoubleSide;
      material.needsUpdate = true;
    }
  });
}

function cityCamera(): CameraPreset {
  return { position: [12.8, 12.8, 19.8] as const, target: [0, 1.5, -5.8] as const, fov: 50 };
}

function characterCamera(): CameraPreset {
  return { position: [2.55, 1.78, 4.25] as const, target: [0, 0.95, 0] as const, fov: 32 };
}

function resize(): void {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frame(): void {
  camera.position.x += (targetCamera.position[0] - camera.position.x) * 0.09;
  camera.position.y += (targetCamera.position[1] - camera.position.y) * 0.09;
  camera.position.z += (targetCamera.position[2] - camera.position.z) * 0.09;
  camera.fov += (targetCamera.fov - camera.fov) * 0.09;
  camera.updateProjectionMatrix();
  camera.lookAt(...targetCamera.target);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
camera.position.set(...targetCamera.position);
camera.lookAt(...targetCamera.target);
frame();

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`The native art review is missing ${selector}.`);
  return element;
}
