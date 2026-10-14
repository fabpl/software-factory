import type { BrowserWindowConstructorOptions } from 'electron';

/** Options de la fenêtre unique (H3) : le renderer ne voit que l'API du preload. */
export function windowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    title: 'Software Factory',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
