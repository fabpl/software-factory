import { describe, expect, it } from 'vitest';
import { windowOptions } from '../src/main/window';

describe('windowOptions (H3, C3)', () => {
  it('isole le renderer : contextIsolation, pas de nodeIntegration, sandbox', () => {
    const options = windowOptions('/app/out/preload/index.cjs');
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: '/app/out/preload/index.cjs',
    });
  });

  it('donne un titre et une taille de départ', () => {
    const options = windowOptions('/p');
    expect(options.title).toBe('Software Factory');
    expect(options.width).toBeGreaterThan(0);
    expect(options.height).toBeGreaterThan(0);
  });
});
