import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changelogPath,
  changelogVersions,
  defaultSkillsDir,
  loadSkill,
  parseSkill,
  skillPath,
  SKILL_NAMES,
} from '../src/index.js';

const skillsDir = defaultSkillsDir();
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: skillsDir })
  .toString()
  .trim();

function lastTag(): string | undefined {
  try {
    const out = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

function atTag(tag: string, path: string): string | undefined {
  try {
    return execFileSync('git', ['show', `${tag}:${relative(repoRoot, path)}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return undefined;
  }
}

describe('changelog', () => {
  it('extrait les versions', () => {
    expect(changelogVersions('# T\n\n## 0.2.0 — x\n\n## 0.1.0 — y\n')).toEqual(['0.2.0', '0.1.0']);
    expect(changelogVersions('rien')).toEqual([]);
  });

  for (const name of SKILL_NAMES) {
    it(`${name} : la version du front matter a son entrée de changelog`, () => {
      const skill = loadSkill(name);
      const versions = changelogVersions(readFileSync(changelogPath(name), 'utf8'));
      expect(versions[0]).toBe(skill.version);
    });

    it(`${name} : version bumpée si le corps a changé depuis le dernier tag`, () => {
      const tag = lastTag();
      if (tag === undefined) return; // aucun tag : rien à comparer, l'entrée de changelog suffit
      const before = atTag(tag, skillPath(name, skillsDir));
      if (before === undefined) return; // skill absente au tag
      const previous = parseSkill(before);
      const current = loadSkill(name);
      if (previous.body !== current.body) expect(current.version).not.toBe(previous.version);
    });
  }
});
