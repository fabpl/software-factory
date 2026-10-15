import type { MenuItemConstructorOptions } from 'electron';
import { productName } from '../../package.json';

/**
 * Gabarits des menus (C4), sans Electron : `app.ts` les passe à `Menu.buildFromTemplate`. Les
 * deux menus mènent aux mêmes actions ; « Quitter » est la fonction unique de `lifecycle.ts` (H9).
 */

export interface MenuActions {
  /** Montre la fenêtre et la met au premier plan. */
  open: () => void;
  refresh: () => void;
  quit: () => void;
}

export const MENU_LABELS = {
  open: 'Ouvrir',
  refresh: 'Rafraîchir',
  quit: 'Quitter',
} as const;

export function trayMenuTemplate(actions: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: MENU_LABELS.open, click: actions.open },
    { label: MENU_LABELS.refresh, click: actions.refresh },
    { type: 'separator' },
    { label: MENU_LABELS.quit, click: actions.quit },
  ];
}

/** Remplace le menu par défaut : ⌘Q passe par `quit`, ⌘R rafraîchit au lieu de recharger. */
export function appMenuTemplate(actions: MenuActions): MenuItemConstructorOptions[] {
  return [
    {
      role: 'appMenu',
      label: productName,
      submenu: [
        { role: 'about', label: `À propos de ${productName}` },
        { type: 'separator' },
        { role: 'hide', label: `Masquer ${productName}` },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { label: MENU_LABELS.quit, accelerator: 'CmdOrCtrl+Q', click: actions.quit },
      ],
    },
    // Sans sous-menu explicite, un rôle de menu garde les libellés anglais d'Electron.
    {
      role: 'editMenu',
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Présentation',
      submenu: [
        { label: MENU_LABELS.refresh, accelerator: 'CmdOrCtrl+R', click: actions.refresh },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'windowMenu',
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Placer dans le Dock' },
        { role: 'zoom', label: 'Réduire/agrandir' },
        { role: 'front', label: 'Tout ramener au premier plan' },
      ],
    },
  ];
}
