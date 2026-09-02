import { Object3D } from 'three';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';

export interface AtlasSceneInstance {
  readonly root: Object3D;
  release(): void;
}

export function cloneAtlasScene(source: Object3D): Object3D {
  return cloneSkinnedScene(source);
}

export function disposeAtlasSceneResources(root: Object3D): void {
  const geometries = new Set<{ dispose(): void }>();
  const materials = new Set<{ dispose(): void }>();
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose(): void };
      material?: { dispose(): void } | Array<{ dispose(): void }>;
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) renderable.material.forEach((material) => materials.add(material));
    else if (renderable.material) materials.add(renderable.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
