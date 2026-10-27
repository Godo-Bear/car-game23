import { CAR_IDS, type CarSetup, cleanPlate, type LiveryPattern, type PaintFinish, PLATE_LENGTH, type PlayerSettings } from '../../shared/api';
import { CARS, carSetup, PAINT_SWATCHES, RIM_SWATCHES, randomPlate } from '../vehicles/cars';
import { CAR_MODELS } from '../vehicles/importedCars';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STATS: [keyof (typeof CARS)['gt']['stats'], string][] = [
  ['speed', 'Top speed'],
  ['acceleration', 'Acceleration'],
  ['handling', 'Handling'],
  ['drift', 'Drift'],
];

type ColorKey = 'paint' | 'accent' | 'rims';

/** Garage tab: pick a car and customise its paint, livery, wheels and race number. */
export class GarageScreen {
  constructor(
    private readonly get: () => PlayerSettings,
    private readonly set: (patch: Partial<PlayerSettings>) => void,
  ) {
    this.buildSwatches('paint', 'sw-paint', PAINT_SWATCHES);
    this.buildSwatches('accent', 'sw-accent', ['#ffffff', '#111214', ...PAINT_SWATCHES.filter((c) => c !== '#f5f5f5' && c !== '#111214').slice(0, 9)]);
    this.buildSwatches('rims', 'sw-rims', RIM_SWATCHES);
    $<HTMLInputElement>('plate-text').maxLength = PLATE_LENGTH;
    this.wire();
  }

  private get setup(): CarSetup {
    const s = this.get();
    return carSetup(s.car, s.garage);
  }

  private customise(patch: Partial<CarSetup>): void {
    const s = this.get();
    this.set({ garage: { ...s.garage, [s.car]: { ...this.setup, ...patch } } });
  }

  private cycle(dir: number): void {
    const i = CAR_IDS.indexOf(this.get().car);
    this.set({ car: CAR_IDS[(i + dir + CAR_IDS.length) % CAR_IDS.length] });
  }

  render(): void {
    const s = this.get();
    const car = CARS[s.car];
    const setup = this.setup;
    $('car-name').textContent = car.name;
    $('car-kind').textContent = car.kind;
    $('car-blurb').textContent = car.blurb;
    $('car-credit').textContent = CAR_MODELS[s.car]?.credit ?? '';
    $('car-dots').replaceChildren(
      ...CAR_IDS.map((id) => {
        const dot = document.createElement('span');
        dot.className = id === s.car ? 'on' : '';
        return dot;
      }),
    );
    $('car-stats').replaceChildren(
      ...STATS.map(([key, label]) => {
        const row = document.createElement('div');
        row.className = 'stat';
        row.innerHTML = `<span>${label}</span><span class="bar"><i style="width:${car.stats[key] * 10}%"></i></span>`;
        return row;
      }),
    );
    for (const key of ['paint', 'accent', 'rims'] as const) {
      const value = setup[key];
      let matched = false;
      $(`sw-${key}`)
        .querySelectorAll<HTMLButtonElement>('.swatch')
        .forEach((b) => {
          const on = b.dataset.color === value;
          matched ||= on;
          b.classList.toggle('active', on);
        });
      const pick = $(`sw-${key}`).querySelector<HTMLInputElement>('input[type=color]')!;
      pick.value = value;
      pick.parentElement!.classList.toggle('active', !matched);
    }
    this.markSeg('seg-finish', setup.finish);
    this.markSeg('seg-pattern', setup.pattern);
    const num = $<HTMLInputElement>('car-number');
    if (document.activeElement !== num) num.value = String(setup.number);
    const plate = $<HTMLInputElement>('plate-text');
    if (document.activeElement !== plate) plate.value = setup.plate;
  }

  private markSeg(id: string, value: string): void {
    $(id)
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => b.classList.toggle('active', b.dataset.value === value));
  }

  private buildSwatches(key: ColorKey, id: string, colors: string[]): void {
    const wrap = $(id);
    for (const color of colors) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.color = color;
      b.style.background = color;
      b.title = color;
      b.setAttribute('aria-label', `Colour ${color}`);
      b.addEventListener('click', () => this.customise({ [key]: color }));
      wrap.append(b);
    }
    // Free colour choice.
    const pick = document.createElement('label');
    pick.className = 'swatch-pick';
    pick.title = 'Custom colour';
    const input = document.createElement('input');
    input.type = 'color';
    input.setAttribute('aria-label', 'Custom colour');
    input.addEventListener('input', () => this.customise({ [key]: input.value.toLowerCase() }));
    pick.append(input);
    wrap.append(pick);
  }

  private wire(): void {
    $('car-prev').addEventListener('click', () => this.cycle(-1));
    $('car-next').addEventListener('click', () => this.cycle(1));
    document.querySelectorAll<HTMLElement>('.garage-tabs [data-ctab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        document.querySelectorAll<HTMLElement>('.garage-tabs [data-ctab]').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll<HTMLElement>('[data-cpane]').forEach((p) => p.classList.toggle('hidden', p.dataset.cpane !== tab.dataset.ctab));
      }),
    );
    (document.querySelector('.garage-tabs [data-ctab]') as HTMLElement).classList.add('active');
    $('seg-finish').addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest('button')?.dataset.value as PaintFinish | undefined;
      if (v) this.customise({ finish: v });
    });
    $('seg-pattern').addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest('button')?.dataset.value as LiveryPattern | undefined;
      if (v) this.customise({ pattern: v });
    });
    $<HTMLInputElement>('car-number').addEventListener('change', (e) => {
      const n = Math.round(Number((e.target as HTMLInputElement).value));
      if (n >= 1 && n <= 99) this.customise({ number: n });
      else this.render();
    });
    // The car updates as you type; leaving the box shows the tidied text.
    const plate = $<HTMLInputElement>('plate-text');
    plate.addEventListener('input', () => {
      const text = cleanPlate(plate.value);
      if (text && text !== this.setup.plate) this.customise({ plate: text });
    });
    plate.addEventListener('change', () => this.render());
    $('plate-random').addEventListener('click', () => this.customise({ plate: randomPlate(Math.random() * 1000) }));
    $('btn-livery-reset').addEventListener('click', () => {
      const s = this.get();
      const garage = { ...s.garage };
      delete garage[s.car];
      this.set({ garage });
    });
    // Arrow keys browse cars while the garage is open (and nothing is being typed into).
    window.addEventListener('keydown', (e) => {
      if ($('screen-home').classList.contains('hidden') || document.querySelector('.hub-panel[data-panel=garage]')!.classList.contains('hidden')) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyQ') this.cycle(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyE') this.cycle(1);
    });
  }
}
