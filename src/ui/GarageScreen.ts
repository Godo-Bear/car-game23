import {
  CAR_IDS,
  type CarId,
  type CarSetup,
  cleanPlate,
  type LiveryPattern,
  type PaintFinish,
  PLATE_LENGTH,
  type PlayerSettings,
  type UpgradePart,
  type Upgrades,
} from '../../shared/api';
import { formatYen, MAX_UPGRADE, NO_UPGRADES, UPGRADE_PARTS, upgradeCost, upgradesOf } from '../../shared/economy';
import { FREE_FINISHES, finishItem, ITEM_KINDS, type ItemKind, SHOP_ITEMS } from '../../shared/items';
import { type AccountService, ApiError } from '../account/AccountService';
import { CARS, type CarStats, carSetup, carStats, PAINT_SWATCHES, RIM_SWATCHES, randomPlate } from '../vehicles/cars';
import { CAR_MODELS } from '../vehicles/importedCars';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STATS: [keyof CarStats, string][] = [
  ['speed', 'Top speed'],
  ['acceleration', 'Acceleration'],
  ['handling', 'Handling'],
  ['braking', 'Braking'],
  ['drift', 'Drift'],
  ['nitro', 'Nitro'],
];

const UPGRADE_INFO: Record<UpgradePart, [string, string]> = {
  engine: ['Engine', 'More power: quicker everywhere, faster at the top'],
  gearbox: ['Gearbox', 'Shorter gears and lightning shifts: better acceleration'],
  aero: ['Aero', 'Less drag: a higher top speed'],
  tyres: ['Tyres', 'Stickier rubber: more grip in every corner'],
  suspension: ['Suspension', 'Stiffer and sharper: the car turns in quicker'],
  brakes: ['Brakes', 'Bigger brakes: stop later for the corners'],
  diff: ['Differential', 'Limited-slip diff: easier, longer drifts'],
  nitro: ['Nitro', 'A bigger tank and a harder push'],
};

/** Stat bars for a car; the part its upgrades add is drawn brighter. */
export function renderStats(el: HTMLElement, car: CarId, upgrades: Upgrades): void {
  const def = CARS[car];
  const base = carStats(def, NO_UPGRADES);
  const now = carStats(def, upgrades);
  el.replaceChildren(
    ...STATS.map(([key, label]) => {
      const row = document.createElement('div');
      row.className = 'stat';
      const extra = now[key] - base[key];
      row.innerHTML = `<span>${label}</span><span class="bar"><i style="width:${base[key] * 10}%"></i>${extra > 0 ? `<i class="up" style="width:${extra * 10}%"></i>` : ''}</span>`;
      return row;
    }),
  );
}

/** One dot per car, the current one lit. */
export function renderDots(el: HTMLElement, ids: CarId[], current: CarId): void {
  el.replaceChildren(
    ...ids.map((id) => {
      const dot = document.createElement('span');
      dot.className = id === current ? 'on' : '';
      return dot;
    }),
  );
}

type ColorKey = 'paint' | 'accent' | 'rims';

/** Garage tab: your cars - pick one, paint it, fit plates and buy upgrades. */
export class GarageScreen {
  constructor(
    private readonly get: () => PlayerSettings,
    private readonly set: (patch: Partial<PlayerSettings>) => void,
    private readonly account: AccountService,
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

  private get owned(): CarId[] {
    const owned = this.account.wallet.owned;
    return CAR_IDS.filter((id) => owned.includes(id));
  }

  private customise(patch: Partial<CarSetup>): void {
    const s = this.get();
    this.set({ garage: { ...s.garage, [s.car]: { ...this.setup, ...patch } } });
  }

  private cycle(dir: number): void {
    const owned = this.owned;
    if (owned.length < 2) return;
    const i = owned.indexOf(this.get().car);
    this.set({ car: owned[(i + dir + owned.length) % owned.length] });
  }

  render(): void {
    const s = this.get();
    const car = CARS[s.car];
    const setup = this.setup;
    const upgrades = upgradesOf(this.account.wallet, s.car);
    $('car-name').textContent = car.name;
    $('car-kind').textContent = car.kind;
    $('car-blurb').textContent = car.blurb;
    $('car-credit').textContent = CAR_MODELS[s.car]?.credit ?? '';
    renderDots($('car-dots'), this.owned, s.car);
    for (const id of ['car-prev', 'car-next']) $<HTMLButtonElement>(id).disabled = this.owned.length < 2;
    renderStats($('car-stats'), s.car, upgrades);
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
    // Premium finishes are bought in the shop.
    const items = this.account.wallet.items;
    $('seg-finish')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => {
        const finish = b.dataset.value as PaintFinish;
        const item = finishItem(finish);
        const locked = !FREE_FINISHES.includes(finish) && !!item && !items.includes(item.id);
        b.disabled = locked;
        b.classList.toggle('locked', locked);
        b.title = locked && item ? `Buy ${item.name} in the shop (${formatYen(item.price)})` : '';
      });
    this.renderExtras(setup);
    this.markSeg('seg-pattern', setup.pattern);
    const num = $<HTMLInputElement>('car-number');
    if (document.activeElement !== num) num.value = String(setup.number);
    const plate = $<HTMLInputElement>('plate-text');
    if (document.activeElement !== plate) plate.value = setup.plate;
    this.renderUpgrades(upgrades);
  }

  /** Extras: underglow, flame and smoke colours you've bought (or none). */
  private renderExtras(setup: CarSetup): void {
    const owned = this.account.wallet.items;
    $('extras').replaceChildren(
      ...ITEM_KINDS.filter((k) => k.kind !== 'finish').map(({ kind, name }) => {
        const key = kind as Exclude<ItemKind, 'finish'>;
        const row = document.createElement('div');
        row.className = 'extra-row';
        row.append(Object.assign(document.createElement('h3'), { textContent: name }));
        const wrap = document.createElement('div');
        wrap.className = 'swatches';
        const choice = (id: string | undefined, label: string, color: string | null, have: boolean) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `swatch item-swatch${color ? '' : ' none'}${have ? '' : ' locked'}`;
          if (color) b.style.background = color;
          b.title = have ? label : `${label} — in the shop`;
          b.setAttribute('aria-label', b.title);
          b.disabled = !have;
          b.classList.toggle('active', setup[key] === id);
          b.addEventListener('click', () => this.customise({ [key]: id }));
          return b;
        };
        wrap.append(choice(undefined, 'None', null, true));
        for (const item of SHOP_ITEMS.filter((x) => x.kind === kind)) wrap.append(choice(item.id, item.name, item.color, owned.includes(item.id)));
        row.append(wrap);
        return row;
      }),
    );
  }

  private renderUpgrades(upgrades: Upgrades): void {
    const car = this.get().car;
    const credits = this.account.wallet.credits;
    $('upgrades').replaceChildren(
      ...UPGRADE_PARTS.map((part) => {
        const [name, info] = UPGRADE_INFO[part];
        const level = upgrades[part];
        const row = document.createElement('div');
        row.className = 'upgrade';
        const text = document.createElement('div');
        text.innerHTML = `<b>${name}</b><small class="muted">${info}</small>`;
        const pips = document.createElement('span');
        pips.className = 'pips';
        pips.setAttribute('aria-label', `Level ${level} of ${MAX_UPGRADE}`);
        for (let i = 0; i < MAX_UPGRADE; i++) pips.append(Object.assign(document.createElement('i'), { className: i < level ? 'on' : '' }));
        const buy = document.createElement('button');
        buy.type = 'button';
        if (level >= MAX_UPGRADE) {
          buy.textContent = 'MAX';
          buy.disabled = true;
        } else {
          const price = upgradeCost(car, part, level + 1);
          buy.textContent = `Upgrade ${formatYen(price)}`;
          buy.disabled = credits < price;
          buy.title = credits < price ? 'Win races to earn more money' : '';
          buy.addEventListener('click', () => void this.buyUpgrade(part));
        }
        row.append(text, pips, buy);
        return row;
      }),
    );
  }

  private async buyUpgrade(part: UpgradePart): Promise<void> {
    const note = $('upgrade-note');
    try {
      await this.account.buy({ kind: 'upgrade', car: this.get().car, part });
      note.textContent = `${UPGRADE_INFO[part][0]} upgraded!`;
    } catch (e) {
      note.textContent = e instanceof ApiError ? e.message : 'Could not buy that. Please try again.';
    }
    this.render();
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
        $('upgrade-note').textContent = '';
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
