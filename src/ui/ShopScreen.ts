import { CAR_IDS, type CarId, type CarSetup } from '../../shared/api';
import { CAR_PRICES, formatYen, NO_UPGRADES } from '../../shared/economy';
import { formatDp, ITEM_KINDS, SHOP_ITEMS, type ShopItem } from '../../shared/items';
import { type AccountService, ApiError } from '../account/AccountService';
import { CARS } from '../vehicles/cars';
import { CAR_MODELS } from '../vehicles/importedCars';
import { renderDots, renderStats } from './GarageScreen';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type ShopTab = 'cars' | 'items';

/** Shop tab: browse every car on the turntable and buy the ones you can afford, plus cosmetics. */
export class ShopScreen {
  private viewing: CarId = CAR_IDS[1];
  private tab: ShopTab = 'cars';
  /** Cosmetic being tried on. */
  private trying: ShopItem | null = null;

  constructor(
    private readonly account: AccountService,
    /** Show a car on the turntable. */
    private readonly preview: (id: CarId) => void,
    /** A car was bought: make it the one you race. */
    private readonly bought: (id: CarId) => void,
    /** Your car as set up in the garage. */
    private readonly yourSetup: () => CarSetup,
    /** Show your car on the turntable with a cosmetic tried on. */
    private readonly tryOn: (setup: CarSetup) => void,
  ) {
    document.querySelectorAll<HTMLElement>('.shop-tabs [data-stab]').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.stab as ShopTab)));
    $('shop-prev').addEventListener('click', () => this.cycle(-1));
    $('shop-next').addEventListener('click', () => this.cycle(1));
    $('shop-buy').addEventListener('click', () => void this.buy());
    window.addEventListener('keydown', (e) => {
      if ($('screen-home').classList.contains('hidden') || document.querySelector('.hub-panel[data-panel=shop]')!.classList.contains('hidden')) return;
      if (e.target instanceof HTMLInputElement || this.tab !== 'cars') return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyQ') this.cycle(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyE') this.cycle(1);
    });
  }

  /** Opening the shop: start on the cheapest car you don't have yet. */
  open(): void {
    const owned = this.account.wallet.owned;
    this.viewing = CAR_IDS.find((id) => !owned.includes(id)) ?? CAR_IDS[CAR_IDS.length - 1];
    $('shop-note').textContent = '';
    this.showTab(this.tab);
  }

  private showTab(tab: ShopTab): void {
    this.tab = tab;
    document.querySelectorAll<HTMLElement>('.shop-tabs [data-stab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.stab === tab);
      b.setAttribute('aria-selected', String(b.dataset.stab === tab));
    });
    document.querySelectorAll<HTMLElement>('[data-spane]').forEach((p) => p.classList.toggle('hidden', p.dataset.spane !== tab));
    $('item-note').textContent = '';
    this.trying = null;
    if (tab === 'cars') this.show();
    else {
      this.render();
      this.tryOn(this.yourSetup());
    }
  }

  private cycle(dir: number): void {
    const i = CAR_IDS.indexOf(this.viewing);
    this.viewing = CAR_IDS[(i + dir + CAR_IDS.length) % CAR_IDS.length];
    $('shop-note').textContent = '';
    this.show();
  }

  private show(): void {
    this.render();
    this.preview(this.viewing);
  }

  render(): void {
    this.renderItems();
    const id = this.viewing;
    const car = CARS[id];
    const { credits, owned } = this.account.wallet;
    const have = owned.includes(id);
    const price = CAR_PRICES[id];
    $('shop-name').textContent = car.name;
    $('shop-kind').textContent = car.kind;
    $('shop-blurb').textContent = car.blurb;
    $('shop-credit').textContent = CAR_MODELS[id]?.credit ?? '';
    renderDots($('shop-dots'), CAR_IDS, id);
    renderStats($('shop-stats'), id, NO_UPGRADES);
    $('shop-price').textContent = have ? 'Owned' : formatYen(price);
    const buy = $<HTMLButtonElement>('shop-buy');
    buy.textContent = have ? 'In your garage ✓' : credits >= price ? `Buy for ${formatYen(price)}` : `Need ${formatYen(price - credits)} more`;
    buy.disabled = have || credits < price;
  }

  /** Cosmetics, by kind: each with its colour, price and a buy button. */
  private renderItems(): void {
    const w = this.account.wallet;
    $('shop-dp').textContent = formatDp(w.dp);
    $('shop-money').textContent = formatYen(w.credits);
    $('shop-items').replaceChildren(
      ...ITEM_KINDS.map(({ kind, name }) => {
        const group = document.createElement('section');
        group.className = 'item-group';
        group.append(Object.assign(document.createElement('h3'), { textContent: name }));
        const grid = document.createElement('div');
        grid.className = 'item-grid';
        for (const item of SHOP_ITEMS.filter((x) => x.kind === kind)) {
          const have = w.items.includes(item.id);
          const funds = item.currency === 'dp' ? w.dp : w.credits;
          const price = item.currency === 'dp' ? formatDp(item.price) : formatYen(item.price);
          const tile = document.createElement('div');
          tile.className = `item-tile${have ? ' owned' : ''}${this.trying === item ? ' trying' : ''}`;
          const look = Object.assign(document.createElement('button'), { type: 'button', className: 'item-look', title: `Try ${item.name} on your car` });
          look.innerHTML = `<span class="item-swatch k-${kind}" style="--c:${item.color}"></span><b>${item.name}</b>`;
          look.addEventListener('click', () => this.tryItem(item));
          const buy = Object.assign(document.createElement('button'), { type: 'button', className: 'item-buy' });
          buy.textContent = have ? 'Owned ✓' : price;
          buy.disabled = have || funds < item.price;
          if (!have && funds < item.price) buy.title = item.currency === 'dp' ? 'Drift in races to score more DP' : 'Win races to earn more money';
          buy.addEventListener('click', () => void this.buyItem(item));
          tile.append(look, buy);
          grid.append(tile);
        }
        group.append(grid);
        return group;
      }),
    );
  }

  private tryItem(item: ShopItem): void {
    this.trying = item;
    const setup = this.yourSetup();
    this.tryOn(item.kind === 'finish' && item.finish ? { ...setup, finish: item.finish } : { ...setup, [item.kind]: item.id });
    $('item-note').textContent =
      item.kind === 'flame' ? `${item.name}: shows when you fire the nitro.` : item.kind === 'smoke' ? `${item.name}: shows when you drift.` : '';
    this.renderItems();
  }

  private async buyItem(item: ShopItem): Promise<void> {
    const note = $('item-note');
    try {
      await this.account.buy({ kind: 'item', item: item.id });
      note.textContent = `${item.name} is yours! Fit it in the Garage${item.kind === 'finish' ? ' (Paint tab)' : ' (Extras tab)'}.`;
    } catch (e) {
      note.textContent = e instanceof ApiError ? e.message : 'Could not buy that. Please try again.';
    }
    this.render();
  }

  private async buy(): Promise<void> {
    const id = this.viewing;
    const note = $('shop-note');
    try {
      await this.account.buy({ kind: 'car', car: id });
      note.textContent = `${CARS[id].name} is yours! It's waiting in your garage.`;
      this.bought(id);
    } catch (e) {
      note.textContent = e instanceof ApiError ? e.message : 'Could not buy that. Please try again.';
    }
    this.render();
  }
}
