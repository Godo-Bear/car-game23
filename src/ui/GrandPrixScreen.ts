import type { Difficulty } from '../../shared/api';
import { freeDriveUnlocked } from '../../shared/career';
import { CUPS, cup, cupUnlocked, trophyBonus, trophyOf } from '../../shared/grandprix';
import type { AccountService } from '../account/AccountService';
import { courseInfo } from '../track/tracks';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CLASS_NAME: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const MEDAL = ['', '🥇', '🥈', '🥉'];
const TROPHY_NAME = ['', 'Gold', 'Silver', 'Bronze'];
const TROPHY_COLOR = ['', '#ffcc33', '#d8dde6', '#d9905a'];

/** A row of the standings: a driver's name and colour, this race and in total. */
export interface GpRow {
  name: string;
  color: string;
  me: boolean;
  place: number;
  race: number;
  points: number;
}

/**
 * The Grand Prix screens: choosing a cup and class (Play → Grand Prix), the standings under
 * each race's results, and the trophy ceremony at the end of a cup.
 */
export class GrandPrixScreen {
  cupId = CUPS[0].id;
  difficulty: Difficulty = 'normal';

  constructor(
    private readonly account: AccountService,
    private readonly handlers: { onStart(cupId: string, difficulty: Difficulty): void; onNext(): void; onMenu(): void; onHome(): void },
  ) {
    $('gp-class').addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest('button')?.dataset.value as Difficulty | undefined;
      if (!v) return;
      this.difficulty = v;
      this.render();
    });
    $('btn-gp-start').addEventListener('click', () => {
      if (this.open(this.cupId)) this.handlers.onStart(this.cupId, this.difficulty);
    });
    $('btn-gp-next').addEventListener('click', () => this.handlers.onNext());
    $('btn-trophy-gp').addEventListener('click', () => {
      $('screen-trophy').classList.add('hidden');
      this.handlers.onMenu();
    });
    $('btn-trophy-home').addEventListener('click', () => {
      $('screen-trophy').classList.add('hidden');
      this.handlers.onHome();
    });
  }

  private open(id: string): boolean {
    const c = cup(id);
    return !!c && cupUnlocked(this.account.wallet, c, freeDriveUnlocked(this.account.wallet));
  }

  /** The Play tab's card: how many trophies so far. */
  summary(): string {
    const n = Object.keys(this.account.wallet.trophies).length;
    const gold = Object.values(this.account.wallet.trophies).filter((p) => p === 1).length;
    return n ? `${CUPS.length} cups · items on · 🏆 ${n} trophies (${gold} gold)` : `${CUPS.length} four-race cups with items · win trophies`;
  }

  render(): void {
    const w = this.account.wallet;
    const free = freeDriveUnlocked(w);
    if (!this.open(this.cupId)) this.cupId = CUPS[0].id;
    $('gp-cups').replaceChildren(
      ...CUPS.map((c) => {
        const open = cupUnlocked(w, c, free);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `gp-cup${c.id === this.cupId ? ' selected' : ''}${open ? '' : ' locked'}`;
        b.style.setProperty('--cup', c.color);
        const medals = (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => {
          const t = trophyOf(w, c.id, d);
          return `<span class="gp-medal${t ? '' : ' none'}" title="${CLASS_NAME[d]}: ${t ? TROPHY_NAME[t] : 'no trophy yet'}">${t ? MEDAL[t] : '·'}</span>`;
        });
        const why = c.unlock === 'trophy' ? 'Win any trophy to unlock' : 'Unlock free drive to race here';
        b.innerHTML = `<span class="gp-emblem">${c.emblem}</span><span class="gp-cup-text"><b>${c.name}</b><small>${
          open ? c.races.map((r) => courseInfo(r.track).short).join(' · ') : `🔒 ${why}`
        }</small></span><span class="gp-medals">${medals.join('')}</span>`;
        b.addEventListener('click', () => {
          if (!open) return;
          this.cupId = c.id;
          this.render();
        });
        return b;
      }),
    );
    $('gp-class')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => b.classList.toggle('active', b.dataset.value === this.difficulty));
    const c = cup(this.cupId)!;
    const had = trophyOf(w, c.id, this.difficulty);
    $('gp-info').textContent =
      `${c.blurb}. ${c.laps} laps a race, 8 cars, items on. Trophy bonus at ${CLASS_NAME[this.difficulty]}: 🥇 ¥${trophyBonus(1, this.difficulty).toLocaleString('en-US')}${
        had ? ` (you have ${TROPHY_NAME[had].toLowerCase()})` : ''
      }.`;
  }

  /** Under a race's results: the cup standings, and the button on to the next race (or the trophy). */
  showStandings(info: { cupName: string; round: number; rounds: number; rows: GpRow[] } | null): void {
    const box = $('results-gp');
    const gp = info !== null;
    box.classList.toggle('hidden', !gp);
    $('btn-gp-next').classList.toggle('hidden', !gp);
    $('btn-again').classList.toggle('hidden', gp);
    $('btn-results-map').classList.toggle('hidden', gp);
    if (!info) return;
    const last = info.round === info.rounds - 1;
    $('btn-gp-next').textContent = last ? 'Trophy ceremony ▶' : `Next race ▶ (${info.round + 2}/${info.rounds})`;
    box.innerHTML = `<h3>${escapeHtml(info.cupName)} · after race ${info.round + 1} of ${info.rounds}</h3><table class="results gp-table"><tr><th></th><th>Driver</th><th>Race</th><th>Points</th></tr>${info.rows
      .map(
        (r, i) =>
          `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><span class="swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}</td><td>${
            r.place ? `P${r.place} · +${r.race}` : '—'
          }</td><td><b>${r.points}</b></td></tr>`,
      )
      .join('')}</table>`;
    $('btn-gp-next').focus({ preventScroll: true });
  }

  /** The end of a cup: your trophy (or not), the bonus, and the final standings. */
  showTrophy(info: { cupName: string; difficulty: Difficulty; place: number; bonus: number; rows: GpRow[] }): void {
    const won = info.place <= 3;
    $('trophy-art').innerHTML = won ? trophySvg(TROPHY_COLOR[info.place]) : '<span class="trophy-none">🏁</span>';
    $('trophy-title').textContent = won ? `${TROPHY_NAME[info.place]} trophy!` : `Finished P${info.place}`;
    $('trophy-sub').textContent = `${info.cupName} · ${CLASS_NAME[info.difficulty]}${won ? '' : ' · finish in the top three overall for a trophy'}`;
    $('trophy-bonus').textContent = info.bonus > 0 ? `+¥${info.bonus.toLocaleString('en-US')} trophy bonus` : '';
    $('trophy-table').innerHTML = info.rows
      .slice(0, 8)
      .map(
        (r, i) =>
          `<li class="${r.me ? 'me' : ''}"><span class="pos">${MEDAL[i + 1] ?? i + 1}</span><span class="swatch" style="background:${r.color}"></span><span class="name">${escapeHtml(r.name)}</span><b>${r.points}</b></li>`,
      )
      .join('');
    $('screen-trophy').classList.remove('hidden');
    $('btn-trophy-gp').focus({ preventScroll: true });
  }

  get trophyVisible(): boolean {
    return !$('screen-trophy').classList.contains('hidden');
  }

  hideTrophy(): void {
    $('screen-trophy').classList.add('hidden');
  }
}

function trophySvg(color: string): string {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="0.4" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0.75"/></linearGradient></defs><path d="M36 18h48v18c0 18-10 32-24 34-14-2-24-16-24-34z" fill="url(#tg)" stroke="#5a4210" stroke-width="2"/><path d="M36 26H20c0 16 8 24 18 26M84 26h16c0 16-8 24-18 26" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/><rect x="54" y="70" width="12" height="16" fill="${color}" stroke="#5a4210" stroke-width="2"/><rect x="38" y="86" width="44" height="12" rx="3" fill="#3a2a10" stroke="#5a4210" stroke-width="2"/><rect x="32" y="98" width="56" height="10" rx="3" fill="#2a1d0a"/><text x="60" y="50" font-size="22" font-weight="900" text-anchor="middle" fill="#5a4210">GP</text></svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
