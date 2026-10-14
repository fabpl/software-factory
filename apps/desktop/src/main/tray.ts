import { crc32, deflateSync } from 'node:zlib';
import type { InboxState } from '@factory/orchestrator';
import type { Runtime } from './runtime';

/**
 * Icône de barre de menus et badge (H8). Le badge compte les trois files ; il est vide quand rien
 * n'attend ou quand l'inbox est bloquée. L'icône est une image « template » monochrome dessinée
 * ici et encodée en PNG au chargement : ni dossier `resources/`, ni copie d'assets au build.
 */

export function badgeCount(state: InboxState): number {
  return state.arbitrate.length + state.validate.length + state.act.length;
}

export function badgeText(state: InboxState): string {
  const n = badgeCount(state);
  return n === 0 || state.status === 'blocked' ? '' : String(n);
}

export interface BadgeOptions {
  runtime: Pick<Runtime, 'subscribe'>;
  /** `TrayPort` : `tray.setTitle` doublé de `app.dock.setBadge`. */
  setBadge: (text: string) => void;
}

export function startBadge({ runtime, setBadge }: BadgeOptions): () => void {
  return runtime.subscribe((state) => {
    setBadge(badgeText(state));
  });
}

/** Plateau d'inbox, 16 × 16 ; `#` = opaque. */
const ART = [
  '................',
  '................',
  '..############..',
  '.##..........##.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.####......####.',
  '.#..##....##..#.',
  '.#...######...#.',
  '.#............#.',
  '.##..........##.',
  '..############..',
  '................',
  '................',
];

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG RGBA noir, opacité tirée de `ART`, agrandi au plus proche voisin. */
function pngDataUrl(scale: number): string {
  const size = ART.length * scale;
  const rows: Buffer[] = [];
  for (const line of ART) {
    const row = Buffer.alloc(1 + size * 4); // octet de filtre 0, pixels noirs transparents
    for (let x = 0; x < size; x++) {
      if (line[Math.floor(x / scale)] === '#') row[1 + x * 4 + 3] = 255;
    }
    for (let i = 0; i < scale; i++) rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

export const TRAY_ICON = { x1: pngDataUrl(1), x2: pngDataUrl(2) } as const;

/** Sous-ensemble de `NativeImage` utilisé ici. */
export interface IconImage {
  addRepresentation(options: { scaleFactor: number; dataURL: string }): void;
  setTemplateImage(option: boolean): void;
}

/** `nativeImage` d'Electron, injecté pour tester sans Electron. */
export function trayIcon<T extends IconImage>(nativeImage: {
  createFromDataURL(dataURL: string): T;
}): T {
  const image = nativeImage.createFromDataURL(TRAY_ICON.x1);
  image.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON.x2 });
  image.setTemplateImage(true);
  return image;
}
