import { describe, expect, it } from 'vitest';
import { isAdminCode } from '../shared/admin';

describe('admin code', () => {
  it('accepts the code however it is capitalised or spaced', async () => {
    expect(await isAdminCode('I am Iron man')).toBe(true);
    expect(await isAdminCode('  i AM iron   MAN ')).toBe(true);
  });

  it('rejects anything else', async () => {
    expect(await isAdminCode('I am Spider man')).toBe(false);
    expect(await isAdminCode('')).toBe(false);
  });
});
