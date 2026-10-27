/**
 * Watches the frame rate. Shows the optional FPS counter, and reports when the game has been
 * running slowly for a few seconds in a row so the graphics quality can be stepped down.
 */
const WINDOW = 2.5;
const SLOW_FPS = 40;
/** Consecutive slow windows before reporting (one hitch, e.g. compiling shaders, isn't enough). */
const SLOW_WINDOWS = 2;
const COOLDOWN = 6;

export class PerformanceMonitor {
  private time = 0;
  private frames = 0;
  private slowWindows = 0;
  private cooldown = COOLDOWN;
  private fpsTime = 0;
  private fpsFrames = 0;
  private readonly fpsEl = document.getElementById('fps');

  /** Current frames per second (updated twice a second). */
  fps = 60;

  /**
   * Call once per frame with the real frame time. `measuring` is false while loading, paused or
   * in a menu over a static scene. Returns true when the game has been slow for a while.
   */
  update(rawDt: number, measuring: boolean, showFps: boolean): boolean {
    this.fpsEl?.classList.toggle('hidden', !showFps);
    // A single gap of over a second is a background tab or a debugger pause, not the GPU.
    if (rawDt <= 0 || rawDt > 1) return false;
    this.fpsTime += rawDt;
    this.fpsFrames++;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsTime = 0;
      this.fpsFrames = 0;
      if (showFps && this.fpsEl) this.fpsEl.textContent = `${Math.round(this.fps)} FPS`;
    }

    if (!measuring) {
      this.reset();
      return false;
    }
    if (this.cooldown > 0) {
      this.cooldown -= rawDt;
      return false;
    }
    this.time += rawDt;
    this.frames++;
    if (this.time < WINDOW) return false;
    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    this.slowWindows = fps < SLOW_FPS ? this.slowWindows + 1 : 0;
    if (this.slowWindows < SLOW_WINDOWS) return false;
    this.slowWindows = 0;
    this.cooldown = COOLDOWN;
    return true;
  }

  /** Start measuring afresh (after a quality change, loading, a pause...). */
  reset(): void {
    this.time = 0;
    this.frames = 0;
    this.slowWindows = 0;
  }
}
