import { PropertyBinding, type Object3D } from 'three';

// GLTFLoader in Three 0.185.1 sanitizes node names for animation binding:
// foot.L becomes footL. Hand-made Object3D test fixtures do not do this.
export function findAtlasBone(root: Object3D, authoredName: string): Object3D | undefined {
  return root.getObjectByName(authoredName) ?? root.getObjectByName(PropertyBinding.sanitizeNodeName(authoredName));
}

export function matchesAtlasBone(runtimeName: string, authoredName: string): boolean {
  return runtimeName === authoredName || runtimeName === PropertyBinding.sanitizeNodeName(authoredName);
}
