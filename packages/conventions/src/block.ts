import { group } from './regex.js';

/**
 * Marqueurs cachés `<!-- factory:nom clé=valeur … -->`.
 * Un bloc délimité se termine par `<!-- /factory:nom -->`.
 */

export type Attrs = Readonly<Record<string, string>>;

export interface Marker {
  name: string;
  attrs: Attrs;
}

const MARKER_RE = /<!--\s*factory:([a-z-]+)((?:\s+[a-z_]+=[^\s>]+)*)\s*-->/;

/** Lit le premier marqueur d'ouverture présent dans `text`. */
function parseAttrs(rest: string): Attrs {
  const attrs: Record<string, string> = {};
  for (const pair of rest.trim().split(/\s+/).filter(Boolean)) {
    const eq = pair.indexOf('=');
    attrs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return attrs;
}

export function parseMarker(text: string): Marker | undefined {
  const m = MARKER_RE.exec(text);
  if (!m) return undefined;
  // Les deux groupes existent toujours quand l'expression correspond.
  return { name: group(m, 1), attrs: parseAttrs(group(m, 2)) };
}

export function renderMarker(name: string, attrs: Attrs): string {
  const parts = Object.entries(attrs).map(([k, v]) => `${k}=${v}`);
  return `<!-- factory:${name}${parts.length > 0 ? ' ' + parts.join(' ') : ''} -->`;
}

export function renderClosingMarker(name: string): string {
  return `<!-- /factory:${name} -->`;
}

export interface DelimitedBlock {
  attrs: Attrs;
  /** Contenu entre les deux marqueurs, sans les lignes de marqueur. */
  inner: string;
  /** Indices dans le corps : début du marqueur d'ouverture, fin du marqueur de fermeture. */
  start: number;
  end: number;
}

export function findDelimitedBlock(body: string, name: string): DelimitedBlock | undefined {
  const open = new RegExp(`<!--\\s*factory:${name}((?:\\s+[a-z_]+=[^\\s>]+)*)\\s*-->`);
  const m = open.exec(body);
  if (!m) return undefined;
  const closing = renderClosingMarker(name);
  const closeAt = body.indexOf(closing, m.index + m[0].length);
  if (closeAt < 0) return undefined;
  const inner = body
    .slice(m.index + m[0].length, closeAt)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
  return {
    attrs: parseAttrs(group(m, 1)),
    inner,
    start: m.index,
    end: closeAt + closing.length,
  };
}

/**
 * Remplace le bloc `name` dans `body` par `block` (marqueurs compris).
 * Absent : ajouté à la fin, séparé par une ligne vide. Le reste du corps est intact.
 */
export function replaceDelimitedBlock(body: string, name: string, block: string): string {
  const found = findDelimitedBlock(body, name);
  if (!found) {
    const trimmed = body.replace(/\s+$/, '');
    return trimmed.length === 0 ? block + '\n' : `${trimmed}\n\n${block}\n`;
  }
  return body.slice(0, found.start) + block + body.slice(found.end);
}
