import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveHome } from '../src/main/home';
import { createRuntime } from '../src/main/runtime';
import { fakeOrchestrator } from './fakes';

describe('resolveHome (H7, C8)', () => {
  it('renvoie FACTORY_HOME quand la variable est définie', () => {
    expect(resolveHome({ FACTORY_HOME: '/tmp/maison' }, '/Users/moi')).toBe('/tmp/maison');
  });

  it('sinon <homedir>/.software-factory', () => {
    expect(resolveHome({}, '/Users/moi')).toBe(join('/Users/moi', '.software-factory'));
  });
});

describe('createRuntime (C8)', () => {
  it('passe le dossier maison à bootstrap() comme userData, avec le dépôt s’il est donné', async () => {
    const bootstrap = vi.fn(() => Promise.resolve(fakeOrchestrator()));
    await createRuntime({ bootstrap, home: '/tmp/maison', repo: 'acme/widget' });
    expect(bootstrap).toHaveBeenCalledWith({ userData: '/tmp/maison', repo: 'acme/widget' });
  });

  it('sans dépôt, bootstrap() ne reçoit que userData (détection par gh repo view)', async () => {
    const bootstrap = vi.fn(() => Promise.resolve(fakeOrchestrator()));
    await createRuntime({ bootstrap, home: '/tmp/maison' });
    expect(bootstrap).toHaveBeenCalledWith({ userData: '/tmp/maison' });
  });
});
