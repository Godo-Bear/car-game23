import type { Action, Input } from '../core/Input';
import { clamp } from '../core/math';
import type { VehicleControls } from '../physics/VehiclePhysics';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Pedal = 'throttle' | 'brake' | 'handbrake' | 'nitro';

/**
 * On-screen racing controls for phones and tablets: a steering pad on the left (slide your thumb
 * left or right - further from the middle steers harder) and Gas, Brake, Drift and Nitro on the
 * right. Every control tracks its own finger, so you can steer, accelerate and drift at once.
 * They appear on touch screens (or as soon as the screen is touched) and feed `input.touch`.
 */
export class TouchControls {
  private readonly hud = $('hud');
  private steerFinger: number | null = null;

  constructor(private readonly input: Input) {
    if (matchMedia('(pointer: coarse)').matches) this.enable();
    // A touch anywhere turns them on (e.g. a touch laptop), and taps skip the race intro.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch') return;
        this.enable();
        input.press('skip');
      },
      true,
    );

    this.wireSteering();
    document.querySelectorAll<HTMLElement>('#touch [data-pedal]').forEach((el) => this.wirePedal(el, el.dataset.pedal as Pedal));
    const tap = (id: string, action: Action) =>
      $(id).addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.press(action);
      });
    tap('btn-hud-pause', 'pause');
    tap('btn-touch-camera', 'camera');
    tap('btn-touch-reset', 'reset');
    tap('btn-hud-map', 'map');
    tap('btn-hud-jump', 'jump');
    // A long press shouldn't open the browser's menu over the race.
    this.hud.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private enable(): void {
    if (this.hud.classList.contains('touch')) return;
    this.hud.classList.add('touch');
    document.documentElement.classList.add('touch');
  }

  private get t(): VehicleControls {
    return this.input.touch;
  }

  /** Steering pad: the finger's distance from the pad's middle sets how hard you steer. */
  private wireSteering(): void {
    const pad = $('touch-steer');
    const knob = pad.querySelector<HTMLElement>('.knob')!;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.steerFinger) return;
      const r = pad.getBoundingClientRect();
      const steer = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.36), -1, 1);
      this.t.steer = steer;
      knob.style.transform = `translateX(${steer * r.width * 0.36}px)`;
      pad.classList.toggle('left', steer < -0.1);
      pad.classList.toggle('right', steer > 0.1);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.steerFinger) return;
      this.steerFinger = null;
      this.t.steer = 0;
      knob.style.transform = '';
      pad.classList.remove('left', 'right', 'held');
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.steerFinger = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('held');
      move(e);
    });
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', release);
  }

  /** A pedal button: held while a finger is on it. */
  private wirePedal(el: HTMLElement, pedal: Pedal): void {
    const fingers = new Set<number>();
    const set = (on: boolean) => {
      el.classList.toggle('held', on);
      if (pedal === 'throttle' || pedal === 'brake') this.t[pedal] = on ? 1 : 0;
      else this.t[pedal] = on;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fingers.add(e.pointerId);
      el.setPointerCapture(e.pointerId);
      set(true);
    });
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (!fingers.size) set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  /** Let go of everything (pause, race over, menus). */
  release(): void {
    Object.assign(this.t, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });
    this.steerFinger = null;
    document.querySelectorAll('#touch .held').forEach((el) => el.classList.remove('held', 'left', 'right'));
    const knob = document.querySelector<HTMLElement>('#touch-steer .knob');
    if (knob) knob.style.transform = '';
  }
}
