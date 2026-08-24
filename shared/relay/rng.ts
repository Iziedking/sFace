function mix(value: number): number {
  let state = value >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  return (state ^ (state >>> 16)) >>> 0;
}

function wordAt(seedHex: string, offset: number): number {
  return Number.parseInt(seedHex.slice(offset, offset + 8), 16) >>> 0;
}

export class RelayRng {
  private state: number;

  constructor(seedHex: string) {
    if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error('Relay seed must be 32-byte lowercase hexadecimal.');
    let state = 0x811c9dc5;
    for (let offset = 0; offset < seedHex.length; offset += 8) {
      state = mix((state ^ wordAt(seedHex, offset)) >>> 0);
    }
    this.state = state === 0 ? 0x6d2b79f5 : state;
  }

  nextUint(): number {
    let state = this.state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.state = state >>> 0;
    return this.state;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error('Relay RNG bounds must be ordered integers.');
    }
    const span = max - min + 1;
    return min + (this.nextUint() % span);
  }
}
