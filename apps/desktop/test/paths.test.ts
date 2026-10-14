import { describe, expect, it } from 'vitest';
import { packageRoot } from '../src/main/paths';

describe('packageRoot', () => {
  it('remonte de out/main/<entrée>.js à la racine du paquet', () => {
    expect(packageRoot('file:///x/apps/desktop/out/main/index.js')).toBe('/x/apps/desktop');
    expect(packageRoot('file:///x/apps/desktop/out/main/probe.js')).toBe('/x/apps/desktop');
  });
});
