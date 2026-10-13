import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLog } from '../src/log.js';

describe('log', () => {
  it('écrit une ligne JSON par enregistrement, horodatée', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'log-')), 'logs');
    const log = createLog(dir, { now: () => new Date('2026-10-13T10:00:00Z') });
    log.write(7, { kind: 'event', event: { type: 'run.started' } });
    log.write(7, { kind: 'action', action: { type: 'start-run' } });
    log.write('repo', { kind: 'tick-error', error: 'x' });
    expect(readFileSync(join(dir, '7.jsonl'), 'utf8')).toBe(
      '{"at":"2026-10-13T10:00:00.000Z","kind":"event","event":{"type":"run.started"}}\n' +
        '{"at":"2026-10-13T10:00:00.000Z","kind":"action","action":{"type":"start-run"}}\n',
    );
    expect(readFileSync(join(dir, 'repo.jsonl'), 'utf8')).toContain('tick-error');
  });

  it('purge les fichiers de plus de 30 jours', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'log-')), 'logs');
    const now = new Date('2026-10-13T10:00:00Z');
    const log = createLog(dir, { now: () => now });
    expect(log.purge()).toBe(0);
    log.write(1, { a: 1 });
    log.write(2, { a: 2 });
    writeFileSync(join(dir, 'notes.txt'), 'ignoré');
    const old = new Date(now.getTime() - 31 * 24 * 3600 * 1000);
    utimesSync(join(dir, '1.jsonl'), old, old);
    utimesSync(join(dir, 'notes.txt'), old, old);
    expect(log.purge()).toBe(1);
    expect(readFileSync(join(dir, '2.jsonl'), 'utf8')).toContain('"a":2');
  });
});
