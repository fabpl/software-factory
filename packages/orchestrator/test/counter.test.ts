import { parseCounter } from '@factory/conventions';
import { describe, expect, it } from 'vitest';
import { counterCommand } from '../src/counter.js';
import { FakeGitHub } from '../src/fake/github.js';

const README =
  '# Widget\n\n## Compteur\n\n<!-- factory:counter -->\n**0**\n<!-- /factory:counter -->\n\nfin\n';

function setup(): { github: FakeGitHub; out: string[]; err: string[]; io: Io } {
  const github = new FakeGitHub();
  github.putFile('main', 'README.md', README);
  const out: string[] = [];
  const err: string[] = [];
  return {
    github,
    out,
    err,
    io: { log: (s: string) => out.push(s), error: (s: string) => err.push(s) },
  };
}

interface Io {
  log: (s: string) => void;
  error: (s: string) => void;
}

describe('factory counter add', () => {
  it('crée exactement un commit sur la branche par défaut avec le README incrémenté', async () => {
    const { github, out, io } = setup();
    expect(await counterCommand(github, ['add', 'ouvert', 'le', 'code'], io)).toBe(0);
    expect(github.fileCommits).toHaveLength(1);
    const commit = github.fileCommits[0];
    expect(commit).toMatchObject({ branch: 'main', path: 'README.md' });
    expect(commit?.message).toContain('ouvert le code');
    expect(parseCounter(commit?.content ?? '')).toEqual({
      ok: true,
      value: { value: 1, reasons: ['ouvert le code'] },
    });
    expect((await github.readFile('README.md', 'main'))?.content).toBe(commit?.content);
    expect(github.writes).toEqual(['file main:README.md']);
    expect(out.join('\n')).toContain('1');
  });

  it('raison vide ou multiligne : code non nul, aucun commit', async () => {
    for (const args of [['add'], ['add', '   '], ['add', 'a\nb']]) {
      const { github, err, io } = setup();
      expect(await counterCommand(github, args, io)).not.toBe(0);
      expect(github.fileCommits).toHaveLength(0);
      expect(github.writes).toEqual([]);
      expect(err.length).toBeGreaterThan(0);
    }
  });

  it('sha périmé entre lecture et écriture : code non nul, README inchangé', async () => {
    const { github, err, io } = setup();
    const concurrent = README.replace('fin', 'modifié ailleurs');
    const read = github.readFile.bind(github);
    github.readFile = async (path, branch) => {
      const file = await read(path, branch);
      github.putFile('main', 'README.md', concurrent);
      return file;
    };
    expect(await counterCommand(github, ['add', 'raison'], io)).not.toBe(0);
    expect(github.fileCommits).toHaveLength(0);
    expect((await read('README.md', 'main'))?.content).toBe(concurrent);
    expect(err.join('\n')).toMatch(/changé/);
  });

  it('README absent ou sans bloc compteur : code non nul, aucun commit', async () => {
    const missing = setup();
    missing.github.files.clear();
    expect(await counterCommand(missing.github, ['add', 'r'], missing.io)).not.toBe(0);
    const noBlock = setup();
    noBlock.github.putFile('main', 'README.md', '# rien\n');
    expect(await counterCommand(noBlock.github, ['add', 'r'], noBlock.io)).not.toBe(0);
    expect([...missing.github.fileCommits, ...noBlock.github.fileCommits]).toHaveLength(0);
    expect(noBlock.err.join('\n')).toContain('missing-block');
  });

  it('sous-commande inconnue : usage, code non nul', async () => {
    const { github, err, io } = setup();
    expect(await counterCommand(github, [], io)).not.toBe(0);
    expect(await counterCommand(github, ['remove', 'x'], io)).not.toBe(0);
    expect(err.join('\n')).toContain('usage');
  });
});
