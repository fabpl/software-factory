import {
  findDelimitedBlock,
  renderClosingMarker,
  renderMarker,
  replaceDelimitedBlock,
} from './block.js';
import { group } from './regex.js';
import { err, ok, type Result } from './result.js';

/**
 * Compteur du README : nombre de fois où il a fallu ouvrir le code, et pourquoi.
 *
 *   <!-- factory:counter -->
 *   **2**
 *
 *   1. première raison
 *   2. seconde raison
 *   <!-- /factory:counter -->
 *
 * La valeur n'existe qu'en gras ; une raison par incrément, dans l'ordre chronologique.
 */

export interface Counter {
  value: number;
  reasons: string[];
}

export type CounterError =
  | { kind: 'missing-block' }
  | { kind: 'bad-value'; line: string }
  | { kind: 'bad-reason'; line: string }
  | { kind: 'count-mismatch'; value: number; reasons: number }
  | { kind: 'empty-reason' }
  | { kind: 'multiline-reason' };

export const COUNTER_MARKER = 'counter';

const VALUE_RE = /^\*\*(\d+)\*\*$/;
const REASON_RE = /^\d+\. (.+)$/;

export function parseCounter(readme: string): Result<Counter, CounterError> {
  const block = findDelimitedBlock(readme, COUNTER_MARKER);
  if (!block) return err({ kind: 'missing-block' });
  const [first = '', ...rest] = block.inner.split('\n');
  const value = VALUE_RE.exec(first.trim());
  if (!value) return err({ kind: 'bad-value', line: first });
  const reasons: string[] = [];
  for (const line of rest) {
    if (line.trim() === '') continue;
    const m = REASON_RE.exec(line);
    if (!m) return err({ kind: 'bad-reason', line });
    reasons.push(group(m, 1));
  }
  const n = Number(group(value, 1));
  if (n !== reasons.length)
    return err({ kind: 'count-mismatch', value: n, reasons: reasons.length });
  return ok({ value: n, reasons });
}

export function serializeCounter(counter: Counter): string {
  const list = counter.reasons.map((r, i) => `${String(i + 1)}. ${r}`);
  return [
    renderMarker(COUNTER_MARKER, {}),
    `**${String(counter.value)}**`,
    ...(list.length > 0 ? ['', ...list] : []),
    renderClosingMarker(COUNTER_MARKER),
  ].join('\n');
}

/** README avec le compteur à N+1 et `reason` en dernière ligne ; le reste du texte est intact. */
export function incrementCounter(readme: string, reason: string): Result<string, CounterError> {
  if (/[\r\n]/.test(reason)) return err({ kind: 'multiline-reason' });
  const trimmed = reason.trim();
  if (trimmed === '') return err({ kind: 'empty-reason' });
  const parsed = parseCounter(readme);
  if (!parsed.ok) return parsed;
  const next = serializeCounter({
    value: parsed.value.value + 1,
    reasons: [...parsed.value.reasons, trimmed],
  });
  return ok(replaceDelimitedBlock(readme, COUNTER_MARKER, next));
}
