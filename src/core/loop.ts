/**
 * Fixed-timestep game loop.
 *
 * Update runs at a fixed rate so physics and spawning are deterministic, which
 * matters because two players on different devices must get identical runs from
 * the same seed. Rendering runs as fast as the display allows and interpolates.
 *
 * Frame time is clamped so a backgrounded tab does not fast-forward the run on
 * return, which would desync a challenge.
 */

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250;

export interface LoopHandlers {
  update(stepSeconds: number): void;
  render(alpha: number): void;
}

export class GameLoop {
  private running = false;
  private accumulator = 0;
  private lastTime = 0;
  private frameId = 0;

  constructor(private handlers: LoopHandlers) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    const frameMs = Math.min(now - this.lastTime, MAX_FRAME_MS);
    this.lastTime = now;
    this.accumulator += frameMs;

    while (this.accumulator >= STEP_MS) {
      this.handlers.update(STEP_MS / 1000);
      this.accumulator -= STEP_MS;
    }

    this.handlers.render(this.accumulator / STEP_MS);
    this.frameId = requestAnimationFrame(this.tick);
  };
}
