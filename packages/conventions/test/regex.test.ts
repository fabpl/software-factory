import { describe, expect, it } from 'vitest';
import { group } from '../src/regex.js';

describe('group', () => {
  it('retourne le groupe présent et lève sur un groupe absent', () => {
    const m = /(a)(b)?/.exec('a');
    if (!m) throw new Error('impossible');
    expect(group(m, 1)).toBe('a');
    expect(() => group(m, 2)).toThrow('groupe de capture 2 absent dans « a »');
  });
});
