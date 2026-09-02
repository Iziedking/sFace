/*
 * WCAG contrast, so "is the glass readable" is a test rather than an opinion.
 *
 * The panels are translucent and sit over a live 3D world, so the honest
 * question is not the token against the token but the token against the token
 * composited over the brightest backdrop the city can produce.
 */
function channels(colour: string): readonly [number, number, number, number] {
  const rgba = colour.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16), 1];
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

export function flattenOver(layer: string, base: string): string {
  const [layerRed, layerGreen, layerBlue, alpha] = channels(layer);
  const [baseRed, baseGreen, baseBlue] = channels(base);
  return toHex(
    layerRed * alpha + baseRed * (1 - alpha),
    layerGreen * alpha + baseGreen * (1 - alpha),
    layerBlue * alpha + baseBlue * (1 - alpha),
  );
}

function relativeLuminance(colour: string): number {
  const [red, green, blue] = channels(colour);
  const linear = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
