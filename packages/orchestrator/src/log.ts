import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Journal JSONL par issue (SPEC-orchestrator, « Journal ») : chaque `FactoryEvent` et chaque
 * action de réconciliation, purge à 30 jours. Hors source de vérité.
 */

export interface Log {
  readonly dir: string;
  write(key: number | string, record: Record<string, unknown>): void;
  /** Supprime les fichiers plus vieux que `maxAgeDays` (date de dernière écriture). */
  purge(): number;
}

export interface LogOptions {
  now?: () => Date;
  maxAgeDays?: number;
}

export function createLog(dir: string, options: LogOptions = {}): Log {
  const now = options.now ?? ((): Date => new Date());
  const maxAgeMs = (options.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
  return {
    dir,
    write(key, record) {
      mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({ at: now().toISOString(), ...record });
      appendFileSync(join(dir, `${String(key)}.jsonl`), line + '\n');
    },
    purge() {
      if (!existsSync(dir)) return 0;
      let removed = 0;
      const limit = now().getTime() - maxAgeMs;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        const file = join(dir, name);
        if (statSync(file).mtimeMs < limit) {
          unlinkSync(file);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
