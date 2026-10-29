import { describe, expect, it } from 'vitest';
import { NO_UPGRADES, newWallet, STARTING_CREDITS } from '../shared/economy';
import { cleanWallet, hasGuestProgress, mergeWallets } from '../shared/wallet';

describe('moving guest progress into an account', () => {
  it('only counts a guest that has earned or bought something', () => {
    expect(hasGuestProgress(newWallet())).toBe(false);
    expect(hasGuestProgress({ ...newWallet(), items: ['glow-pink'] })).toBe(true);
    expect(hasGuestProgress({ ...newWallet(), dp: 10 })).toBe(true);
    expect(hasGuestProgress({ ...newWallet(), credits: STARTING_CREDITS + 100 })).toBe(true);
  });

  it('adds the guest purchases and earnings to the account', () => {
    const account = cleanWallet({
      credits: 50_000,
      dp: 1000,
      dpTotal: 9000,
      items: ['glow-blue'],
      upgrades: { gt: { engine: 3, tyres: 1 } },
      events: { 'tokyo-debut': 2 },
      stars: { 'tokyo-debut': 1 },
      quests: ['wins-25'],
    });
    const guest = cleanWallet({
      credits: STARTING_CREDITS + 7000,
      dp: 4000,
      dpTotal: 6000,
      items: ['glow-blue', 'smoke-red', 'finish-chrome'],
      upgrades: { gt: { engine: 1, brakes: 4 } },
      events: { 'tokyo-debut': 1, 'sakura-spring': 3 },
      stars: { 'tokyo-debut': 3 },
      quests: ['races-100'],
    });
    const m = mergeWallets(account, guest);
    // Money on top (not the guest's free starting money), drift points added.
    expect(m.credits).toBe(57_000);
    expect(m.dp).toBe(5000);
    expect(m.dpTotal).toBe(15_000);
    expect(new Set(m.items)).toEqual(new Set(['glow-blue', 'smoke-red', 'finish-chrome']));
    expect(m.upgrades.gt).toEqual({ ...NO_UPGRADES, engine: 3, tyres: 1, brakes: 4 });
    expect(m.events).toEqual({ 'tokyo-debut': 1, 'sakura-spring': 3 });
    expect(m.stars).toEqual({ 'tokyo-debut': 3 });
    expect(new Set(m.quests)).toEqual(new Set(['wins-25', 'races-100']));
    // Junk from the browser is cleaned.
    expect(mergeWallets(account, { items: ['nope'], dp: -5, credits: 'lots' })).toEqual(account);
  });
});
