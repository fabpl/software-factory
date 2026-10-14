import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { runApp } from './app';
import { packageRoot } from './paths';

/**
 * Preuve C6 : l'app réelle lancée avec `gh` déconnecté (`GH_TOKEN` invalide, que `gh auth status`
 * refuse) affiche l'écran `blocked`. Capture `apps/desktop/docs/blocked.png` puis quitte.
 * Hors CI : `pnpm --filter desktop screenshot:blocked`.
 */
process.env.GH_TOKEN = 'invalide-pour-la-capture';
const root = packageRoot(import.meta.url);

runApp({
  root,
  onLoaded: async (window) => {
    await delay(1500); // le renderer reçoit l'état et rend l'écran
    const image = await window.webContents.capturePage();
    const file = join(root, 'docs', 'blocked.png');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, image.toPNG());
    console.log(`[capture] ${file}`);
    app.exit(0);
  },
});
