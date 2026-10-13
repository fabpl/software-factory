import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changelogPath, defaultSkillsDir, loadSkill, skillPath } from '../src/index.js';

describe('load', () => {
  it('trouve le dossier skills/ du dépôt', () => {
    expect(defaultSkillsDir().endsWith('/skills')).toBe(true);
    expect(skillPath('framing')).toBe(join(defaultSkillsDir(), 'framing', 'SKILL.md'));
    expect(changelogPath('framing')).toBe(join(defaultSkillsDir(), 'framing', 'CHANGELOG.md'));
  });

  it('échoue proprement hors de tout dépôt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'factory-skills-'));
    expect(() => defaultSkillsDir(join(dir, 'x.js'))).toThrow(/introuvable/);
  });

  it('charge depuis un dossier explicite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'factory-skills-'));
    const text = [
      '---',
      'name: framing',
      'version: 9.9.9',
      'language: fr',
      'adapted_from: interview-me@0.6.12',
      'requires_tools: [emit_card]',
      '---',
      '> https://github.com/addyosmani/agent-skills, MIT, modifié.',
      '',
      '# Corps',
    ].join('\n');
    mkdirSync(join(dir, 'framing'));
    writeFileSync(join(dir, 'framing', 'SKILL.md'), text);
    expect(loadSkill('framing', dir).version).toBe('9.9.9');
  });
});
