import { describe, expect, it } from 'vitest';
import { CONVENTIONS_VERSION } from '../src/index.js';

describe('conventions', () => {
  it('exporte une version', () => {
    expect(CONVENTIONS_VERSION).toBe('0.0.0');
  });
});
