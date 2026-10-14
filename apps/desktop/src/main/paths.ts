import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Racine du paquet depuis l'URL d'une entrée (`out/main/<entrée>.js`). Seules les entrées peuvent
 * s'y fier : rollup place le code partagé dans un chunk, et `app.getAppPath()` vaut le dossier de
 * l'entrée quand Electron est lancé sur un fichier (`electron out/main/probe.js`).
 */
export function packageRoot(entryUrl: string): string {
  return dirname(dirname(dirname(fileURLToPath(entryUrl))));
}
