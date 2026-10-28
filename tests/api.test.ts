import { describe, expect, it } from 'vitest';
import { cleanCarSetup, cleanPlate, DEFAULT_PLATE } from '../shared/api';

const base = { paint: '#1e88ff', finish: 'metallic', pattern: 'stripes', accent: '#ffffff', rims: '#d6dae2', number: 23 };

describe('car setup validation', () => {
  it('accepts a full setup with a plate', () => {
    expect(cleanCarSetup({ ...base, plate: 'JAYDEN1' })).toEqual({ ...base, plate: 'JAYDEN1' });
  });

  it('keeps paint jobs saved before plates existed, with the default plate', () => {
    expect(cleanCarSetup(base)?.plate).toEqual(DEFAULT_PLATE);
  });

  it('tidies typed plates', () => {
    expect(cleanPlate('  jayden   1 ')).toBe('JAYDEN 1');
    expect(cleanPlate('go-fast!!')).toBe('GO-FAST');
    expect(cleanPlate('ABCDEFGHIJK')).toBe('ABCDEFGH'); // 8 characters at most
  });

  it('rejects plates with nothing usable', () => {
    expect(cleanPlate('')).toBeNull();
    expect(cleanPlate('!?*')).toBeNull();
    expect(cleanPlate(1234)).toBeNull();
    // A Japanese plate saved by the previous version: the default takes its place.
    expect(cleanCarSetup({ ...base, plate: { region: '品川', kana: 'さ', number: 1 } })?.plate).toBe(DEFAULT_PLATE);
  });

  it('keeps fitted shop items only when they are known and of the right kind', () => {
    const setup = cleanCarSetup({ ...base, glow: 'glow-blue', flame: 'smoke-red', smoke: 'smoke-pink' });
    expect(setup?.glow).toBe('glow-blue');
    expect(setup?.flame).toBeUndefined();
    expect(setup?.smoke).toBe('smoke-pink');
    expect(cleanCarSetup({ ...base, finish: 'chrome' })?.finish).toBe('chrome');
  });
});
