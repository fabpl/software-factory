import { homedir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '@factory/orchestrator';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron';
import { FOCUS_CHANNEL, STATE_CHANNEL } from '../shared/api';
import { resolveHome } from './home';
import { registerIpc } from './ipc';
import { createLifecycle, type Lifecycle } from './lifecycle';
import { appMenuTemplate, trayMenuTemplate, type MenuActions } from './menu';
import { startNotifier, type Notice } from './notifications';
import { createRuntime, type Bootstrap, type Runtime } from './runtime';
import { startBadge, trayIcon } from './tray';
import { windowOptions } from './window';

/**
 * Process principal : colle Electron seule (H1). `bootstrap()` tel quel, une fenêtre isolée,
 * l'orchestrateur branché sur IPC ; barre de menus, badge, notifications et « fermer = masquer »
 * (T24) délèguent à `tray.ts`, `notifications.ts`, `menu.ts` et `lifecycle.ts`. `index.ts`
 * l'appelle sans crochet ; `screenshot.ts` avec ; `e2e.ts` avec `bootstrapFake` (D2).
 */

export interface AppOptions {
  /** Racine du paquet (`packageRoot(import.meta.url)` depuis l'entrée). */
  root: string;
  /** Remplace le vrai `bootstrap()` ; `FACTORY_REPO` n'est alors pas lu. */
  bootstrap?: Bootstrap;
  /** Remplace le dossier maison résolu par `resolveHome`. */
  home?: string;
  /** Appelé une fois le renderer chargé (capture d'écran, diagnostic). */
  onLoaded?: (window: BrowserWindow, runtime: Runtime) => Promise<void>;
}

let lifecycle: Lifecycle | undefined;
// Références gardées : sinon le ramasse-miettes retire l'icône et les clics de notification.
let tray: Tray | undefined;
const notifications = new Set<Notification>();

function logError(error: unknown): void {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
}

async function start(hooks: AppOptions): Promise<void> {
  const repo = hooks.bootstrap === undefined ? process.env.FACTORY_REPO : undefined;
  const runtime = await createRuntime({
    bootstrap: hooks.bootstrap ?? bootstrap,
    home: hooks.home ?? resolveHome(process.env, homedir()),
    ...(repo !== undefined ? { repo } : {}),
  });
  const out = join(hooks.root, 'out');
  const window = new BrowserWindow(windowOptions(join(out, 'preload', 'index.cjs')));
  const current = createLifecycle({ stop: () => runtime.stop(), app });
  lifecycle = current;
  window.on('close', (event) => {
    current.onClose(event, window);
  });

  const open = (): void => {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
    app.focus({ steal: true });
  };
  const actions: MenuActions = {
    open,
    refresh: () => {
      runtime.current().refresh().catch(logError);
    },
    quit: () => {
      void current.quit();
    },
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(actions)));
  tray = new Tray(trayIcon(nativeImage));
  tray.setToolTip('Software Factory');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(actions)));
  app.on('activate', open);

  registerIpc({
    ipcMain,
    runtime,
    send: (state) => {
      if (!window.isDestroyed()) window.webContents.send(STATE_CHANNEL, state);
    },
  });
  startBadge({
    runtime,
    setBadge: (text) => {
      tray?.setTitle(text);
      app.dock?.setBadge(text);
    },
  });
  startNotifier({
    runtime,
    startedAt: new Date(),
    show: (notice: Notice) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: notice.title, body: notice.body });
      notifications.add(notification);
      notification.on('click', () => {
        notifications.delete(notification);
        open();
        if (notice.cardId !== undefined && !window.isDestroyed()) {
          window.webContents.send(FOCUS_CHANNEL, notice.cardId);
        }
      });
      notification.on('close', () => {
        notifications.delete(notification);
      });
      notification.show();
    },
  });

  runtime.current().start();
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl !== undefined && devUrl !== '') await window.loadURL(devUrl);
  else await window.loadFile(join(out, 'renderer', 'index.html'));
  await hooks.onLoaded?.(window, runtime);
}

export function runApp(hooks: AppOptions): void {
  // Fermer = masquer (H9) : l'app reste dans la barre de menus jusqu'à « Quitter ».
  app.on('window-all-closed', () => undefined);

  // Tout chemin de sortie (⌘Q, menu, Dock, fin de session) arrête l'orchestrateur d'abord.
  app.on('before-quit', (event) => {
    lifecycle?.onBeforeQuit(event);
  });

  void app
    .whenReady()
    .then(() => start(hooks))
    .catch((error: unknown) => {
      logError(error);
      app.exit(1);
    });
}
