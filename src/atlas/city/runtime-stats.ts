export class AtlasRuntimeStats {
  private last: number | null = null;
  private totalMs = 0;
  private frames = 0;
  private slowFrames = 0;
  private shownAt = 0;
  private readonly samples: number[] = [];
  private element: HTMLElement | null = null;

  attach(host: HTMLElement): void {
    this.element?.remove();
    const output = document.createElement('output');
    output.className = 'atlas-runtime-stats';
    output.setAttribute('aria-label', 'Measured runtime statistics');
    host.append(output);
    this.element = output;
  }

  sample(timestamp: number, stats: { drawCalls: number; triangles: number }, tier: string): void {
    const dt = this.last === null ? 0 : timestamp - this.last;
    this.last = timestamp;
    if (dt <= 0 || dt > 250) return;
    this.frames++;
    this.totalMs += dt;
    if (dt > 34) this.slowFrames++;
    this.samples.push(dt);
    if (this.samples.length > 240) this.samples.shift();
    if (!this.element || timestamp - this.shownAt < 1000) return;
    this.shownAt = timestamp;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.element.textContent = `${(1000 * this.frames / this.totalMs).toFixed(1)} FPS avg · p95 ${p95.toFixed(1)} ms · ${this.slowFrames}/${this.frames} >34ms · ${Math.round(this.totalMs / 1000)}s active · ${stats.drawCalls} draws · ${stats.triangles} tris · ${tier} · heap ${memory ? (memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'unavailable'}`;
  }
}
