import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkill, type Skill, type SkillName } from './skill.js';

/**
 * Remonte depuis ce module jusqu'au dossier `skills/` du dépôt (fonctionne depuis `src/` et `dist/`).
 */
export function defaultSkillsDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(from);
  for (;;) {
    const candidate = join(dir, 'skills');
    if (existsSync(join(candidate, 'framing', 'SKILL.md'))) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) throw new Error(`dossier skills/ introuvable depuis ${from}`);
    dir = parent;
  }
}

export function skillPath(name: SkillName, skillsDir: string = defaultSkillsDir()): string {
  return join(skillsDir, name, 'SKILL.md');
}

export function changelogPath(name: SkillName, skillsDir: string = defaultSkillsDir()): string {
  return join(skillsDir, name, 'CHANGELOG.md');
}

export function loadSkill(name: SkillName, skillsDir: string = defaultSkillsDir()): Skill {
  return parseSkill(readFileSync(skillPath(name, skillsDir), 'utf8'));
}

/** Versions listées dans un `CHANGELOG.md` (`## 0.1.0 — …`). */
export function changelogVersions(changelog: string): string[] {
  return [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => String(m[1]));
}
