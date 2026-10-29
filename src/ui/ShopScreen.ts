import type { CarSetup } from '../../shared/api';
import { formatYen } from '../../shared/economy';
import { formatDp, ITEM_KINDS, SHOP_ITEMS, type ShopItem } from '../../shared/items';
import { type AccountService, ApiError } from '../account/AccountService';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Shop tab: cosmetics for your car, bought with drift points (paint finishes with money). */
export class ShopScreen {
  /** Cosmetic being tried on. */
  private trying: ShopItem | null = null;

  constructor(
    private readonly account: AccountService,
    /** Your car as set up in the garage. */
    private readonly yourSetup: () => CarSetup,
    /** Show your car on the turntable with a cosmetic tried on. */
    private readonly tryOn: (setup: CarSetup) => void,
  ) {}

  /** Opening the shop: your car on the turntable as it is. */
  open(): void {
    $('item-note').textContent = '';
    this.trying = null;
    this.render();
    this.tryOn(this.yourSetup());
  }

  render(): void {
    this.renderItems();
    // Guests on a site with accounts: a nudge to log in so purchases are kept in the account.
    $('shop-guest').classList.toggle('hidden', this.account.signedIn || this.account.backend !== 'online');
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
}
