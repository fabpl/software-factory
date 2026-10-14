import { homedir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '@factory/orchestrator';
import { app, BrowserWindow, ipcMain } from 'electron';
import { STATE_CHANNEL } from '../shared/api';
import { resolveHome } from './home';
import { registerIpc } from './ipc';
import { createRuntime, type Runtime } from './runtime';
import { windowOptions } from './window';

/**
 * Process principal (T21) : `bootstrap()` tel quel (H2, H7), une fenêtre isolée (H3),
 * l'orchestrateur branché sur IPC (H4). Barre de menus, icône, notifications et « fermer =
 * masquer » arrivent avec T24. `index.ts` l'appelle sans crochet ; `screenshot.ts` avec.
 */

export interface AppOptions {
  /** Racine du paquet (`packageRoot(import.meta.url)` depuis l'entrée). */
  root: string;
  /** Appelé une fois le renderer chargé (capture d'écran, diagnostic). */
  onLoaded?: (window: BrowserWindow, runtime: Runtime) => Promise<void>;
}

let runtime: Runtime | undefined;

async function start(hooks: AppOptions): Promise<void> {
  const repo = process.env.FACTORY_REPO;
  runtime = await createRuntime({
    bootstrap,
    home: resolveHome(process.env, homedir()),
    ...(repo !== undefined ? { repo } : {}),
  });
  const out = join(hooks.root, 'out');
  const window = new BrowserWindow(windowOptions(join(out, 'preload', 'index.cjs')));
  registerIpc({
    ipcMain,
    runtime,
    send: (state) => {
      if (!window.isDestroyed()) window.webContents.send(STATE_CHANNEL, state);
    },
  });
  runtime.current().start();
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl !== undefined && devUrl !== '') await window.loadURL(devUrl);
  else await window.loadFile(join(out, 'renderer', 'index.html'));
  await hooks.onLoaded?.(window, runtime);
}

export function runApp(hooks: AppOptions): void {
  app.on('window-all-closed', () => {
    app.quit();
  });

  // Quitter arrête l'orchestrateur (annule le run en cours, ≤ 10 s) avant de fermer.
  app.on('before-quit', (event) => {
    if (!runtime) return;
    const stopping = runtime;
    runtime = undefined;
    event.preventDefault();
    void stopping.stop().finally(() => {
      app.quit();
    });
  });

  void app
    .whenReady()
    .then(() => start(hooks))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      app.exit(1);
    });
}
