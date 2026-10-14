import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { appMenuTemplate, trayMenuTemplate } from '../src/main/menu';

function actions() {
  return { open: vi.fn<() => void>(), refresh: vi.fn<() => void>(), quit: vi.fn<() => void>() };
}

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);
}

function click(item: MenuItemConstructorOptions | undefined): void {
  (item?.click as (() => void) | undefined)?.();
}

describe('menu de barre de menus (C4)', () => {
  it('contient Ouvrir, Rafraîchir, Quitter, chacun relié à son action', () => {
    const a = actions();
    const items = trayMenuTemplate(a);
    const labels = items.filter((i) => i.label !== undefined).map((i) => i.label);
    expect(labels).toEqual(['Ouvrir', 'Rafraîchir', 'Quitter']);
    for (const [label, action] of [
      ['Ouvrir', a.open],
      ['Rafraîchir', a.refresh],
      ['Quitter', a.quit],
    ] as const) {
      click(items.find((i) => i.label === label));
      expect(action).toHaveBeenCalledTimes(1);
    }
  });
});

describe('menu d’application (C4)', () => {
  it('⌘Q = Quitter, ⌘R = Rafraîchir', () => {
    const a = actions();
    const items = flatten(appMenuTemplate(a));
    const quit = items.find((i) => i.label === 'Quitter');
    const refresh = items.find((i) => i.label === 'Rafraîchir');
    expect(quit?.accelerator).toBe('CmdOrCtrl+Q');
    expect(refresh?.accelerator).toBe('CmdOrCtrl+R');
    click(quit);
    click(refresh);
    expect(a.quit).toHaveBeenCalledTimes(1);
    expect(a.refresh).toHaveBeenCalledTimes(1);
  });

  it('garde le menu Édition (copier, coller dans les champs)', () => {
    expect(appMenuTemplate(actions()).some((i) => i.role === 'editMenu')).toBe(true);
  });
});
