import { CAR_IDS, type CarId } from '../../shared/api';
import { CAR_PRICES, formatYen, NO_UPGRADES } from '../../shared/economy';
import { type AccountService, ApiError } from '../account/AccountService';
import { CARS } from '../vehicles/cars';
import { CAR_MODELS } from '../vehicles/importedCars';
import { renderDots, renderStats } from './GarageScreen';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Shop tab: browse every car on the turntable and buy the ones you can afford. */
export class ShopScreen {
  private viewing: CarId = CAR_IDS[1];

  constructor(
    private readonly account: AccountService,
    /** Show a car on the turntable. */
    private readonly preview: (id: CarId) => void,
    /** A car was bought: make it the one you race. */
    private readonly bought: (id: CarId) => void,
  ) {
    $('shop-prev').addEventListener('click', () => this.cycle(-1));
    $('shop-next').addEventListener('click', () => this.cycle(1));
    $('shop-buy').addEventListener('click', () => void this.buy());
    window.addEventListener('keydown', (e) => {
      if ($('screen-home').classList.contains('hidden') || document.querySelector('.hub-panel[data-panel=shop]')!.classList.contains('hidden')) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyQ') this.cycle(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyE') this.cycle(1);
    });
  }

  /** Opening the shop: start on the cheapest car you don't have yet. */
  open(): void {
    const owned = this.account.wallet.owned;
    this.viewing = CAR_IDS.find((id) => !owned.includes(id)) ?? CAR_IDS[CAR_IDS.length - 1];
    $('shop-note').textContent = '';
    this.show();
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
