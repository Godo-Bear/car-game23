import { clamp } from './math';
import type { Volumes } from './Settings';

/**
 * Fully synthesised audio (no sound files): engine note driven by RPM and throttle,
 * tyre squeal from slip, wind at speed, kerb rumble, barrier scrapes, impact thuds and countdown
 * beeps. Engine and effects run through separate buses so they have their own volume sliders.
 * The AudioContext is created on the first user gesture, as browsers require.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private fxBus!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private screechGain!: GainNode;
  private windGain!: GainNode;
  private rumbleGain!: GainNode;
  private scrapeGain!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private volumes: Volumes = { master: 0.8, engine: 0.8, effects: 0.8 };

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a click/keypress handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.master);
    this.applyVolumes(0);

    // Engine: two detuned oscillators through a waveshaper and a throttle-controlled low-pass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 800;
    this.engineFilter.Q.value = 4;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5);
    }
    shaper.curve = curve;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const o2gain = ctx.createGain();
    o2gain.gain.value = 0.35;
    this.osc1.connect(shaper);
    this.osc2.connect(o2gain).connect(shaper);
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.engineBus);
    this.osc1.start();
    this.osc2.start();

    // Shared white-noise buffer for tyres, wind and impacts.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const screech = ctx.createBufferSource();
    screech.buffer = this.noise;
    screech.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 6;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    screech.connect(band).connect(this.screechGain).connect(this.fxBus);
    screech.start();

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(low).connect(this.windGain).connect(this.fxBus);
    wind.start();

    // Kerb rumble: low-frequency thrum (pulsed by the caller as the wheels cross the stripes).
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.loop(ctx, 'lowpass', 140, 1).connect(this.rumbleGain).connect(this.fxBus);
    // Barrier scrape: harsh high band of noise.
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.loop(ctx, 'bandpass', 3200, 1.5).connect(this.scrapeGain).connect(this.fxBus);
  }

  private loop(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.5 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter);
    src.start();
    return filter;
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    this.applyVolumes(0.05);
  }

  private applyVolumes(ramp: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const set = (node: GainNode, value: number) => {
      if (ramp > 0) node.gain.setTargetAtTime(value, ctx.currentTime, ramp);
      else node.gain.value = value;
    };
    // Squared so the sliders feel even (loudness is roughly logarithmic).
    set(this.master, this.muted ? 0 : 1.1 * this.volumes.master ** 2);
    set(this.engineBus, this.volumes.engine ** 2 * 1.56);
    set(this.fxBus, this.volumes.effects ** 2 * 1.56);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes(0.05);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Per-frame update from the player's car. Pass active=false in menus to fade the car out. */
  update(rpm: number, throttle: number, slide: number, speed: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Six-cylinder firing frequency = rpm / 60 * 3.
    const f = (rpm / 60) * 3;
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(500 + throttle * 2600 + rpm * 0.15, t, 0.05);
    this.engineGain.gain.setTargetAtTime(active ? 0.06 + throttle * 0.09 : 0, t, 0.08);
    this.screechGain.gain.setTargetAtTime(active ? clamp(slide - 0.35, 0, 1) * 0.22 : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(active ? clamp(speed / 75, 0, 1) ** 2 * 0.18 : 0, t, 0.1);
  }

  /** Continuous surface sounds: `kerb` and `scrape` are 0..1 intensities. */
  surface(kerb: number, scrape: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.rumbleGain.gain.setTargetAtTime(kerb * 0.5, t, 0.03);
    this.scrapeGain.gain.setTargetAtTime(scrape * 0.16, t, 0.04);
  }

  impact(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || strength < 1) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350 + strength * 40;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(clamp(strength / 12, 0.08, 0.9), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(lp).connect(g).connect(this.fxBus);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }

  /** Nitro pickup (0), perfect nitro (1) or a big boost (2): a rising chime, with a whoosh for boosts. */
  boost(level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = level === 0 ? [880, 1320] : level === 1 ? [660, 990, 1320] : [520, 780, 1040, 1560];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const at = t + i * 0.06;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setValueAtTime(0.16, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      o.connect(g).connect(this.fxBus);
      o.start(at);
      o.stop(at + 0.25);
    });
    if (level === 0) return;
    // Whoosh: noise swept up through a band-pass filter.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(level === 2 ? 3200 : 2000, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level === 2 ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(bp).connect(g).connect(this.fxBus);
    src.start(t, Math.random());
    src.stop(t + 0.75);
  }

  beep(high: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = high ? 880 : 440;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.6 : 0.25));
    o.connect(g).connect(this.fxBus);
    o.start(t);
    o.stop(t + 0.65);
  }
}
