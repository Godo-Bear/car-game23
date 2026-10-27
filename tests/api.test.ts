import { describe, expect, it } from 'vitest';
import { cleanCarSetup, cleanPlate, DEFAULT_PLATE } from '../shared/api';

const base = { paint: '#1e88ff', finish: 'metallic', pattern: 'stripes', accent: '#ffffff', rims: '#d6dae2', number: 23 };

describe('car setup validation', () => {
  it('accepts a full setup with a plate', () => {
    const plate = { region: '品川', kana: 'さ', number: 8686 };
    expect(cleanCarSetup({ ...base, plate })).toEqual({ ...base, plate });
  });

  it('keeps paint jobs saved before plates existed, with the default plate', () => {
    expect(cleanCarSetup(base)?.plate).toEqual(DEFAULT_PLATE);
  });

  it('rejects plates that could not exist', () => {
    expect(cleanPlate({ region: '東京', kana: 'さ', number: 1 })).toBeNull(); // not a plate region
    expect(cleanPlate({ region: '品川', kana: 'お', number: 1 })).toBeNull(); // never issued
    expect(cleanPlate({ region: '品川', kana: 'さ', number: 10000 })).toBeNull();
    expect(cleanPlate({ region: '品川', kana: 'さ', number: 0 })).toBeNull();
    expect(cleanPlate({ region: '品川', kana: 'さ', number: 12.5 })).toBeNull();
  });
});
