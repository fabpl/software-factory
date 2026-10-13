import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addRuleLine, appendRule, readRules } from '../src/rules.js';

describe('rules', () => {
  it('crée le fichier avec en-tête et section', () => {
    expect(addRuleLine('', 'Tranché', 'a')).toBe(
      '# Règles du projet (générées, éditables)\n\n## Tranché\n- a\n',
    );
  });

  it('ajoute sous une section existante, avant la suivante, et ignore les doublons', () => {
    const base = '# Règles\n\n## Tranché\n- a\n\n## Bloquant\n- x\n';
    const out = addRuleLine(base, 'Tranché', 'b');
    expect(out).toBe('# Règles\n\n## Tranché\n- a\n- b\n\n## Bloquant\n- x\n');
    expect(addRuleLine(out, 'Tranché', 'b')).toBe(out);
    expect(addRuleLine(out, 'Bloquant', 'y')).toBe(
      '# Règles\n\n## Tranché\n- a\n- b\n\n## Bloquant\n- x\n- y\n',
    );
  });

  it('crée la section manquante en fin de fichier', () => {
    expect(addRuleLine('# Règles\n\n## Tranché\n- a\n', 'Bloquant', 'x')).toBe(
      '# Règles\n\n## Tranché\n- a\n\n## Bloquant\n- x\n',
    );
  });

  it('lit et écrit `.factory/rules.md` du worktree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-'));
    expect(readRules(dir)).toBe('');
    appendRule(dir, 'Bloquant', 'Tout changement de schéma.');
    expect(readRules(dir)).toContain('## Bloquant\n- Tout changement de schéma.');
  });
});
