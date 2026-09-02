export type ThreeCapability =
  | { readonly supported: true; readonly maxTextureSize: number }
  | { readonly supported: false; readonly reason: ThreeCapabilityFailure };

export type ThreeCapabilityFailure =
  | 'webgl2-unavailable'
  | 'texture-limit-too-small'
  | 'context-error';

const MINIMUM_TEXTURE_SIZE = 2048;

export function detectThreeCapability(canvas: HTMLCanvasElement): ThreeCapability {
  try {
    const context = canvas.getContext('webgl2');
    if (!context) return { supported: false, reason: 'webgl2-unavailable' };
    const maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE);
    if (typeof maxTextureSize !== 'number' || maxTextureSize < MINIMUM_TEXTURE_SIZE) {
      return { supported: false, reason: 'texture-limit-too-small' };
    }
    return { supported: true, maxTextureSize };
  } catch {
    return { supported: false, reason: 'context-error' };
  }
}
