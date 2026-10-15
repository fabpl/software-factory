import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorktrees, type WorktreePort } from '../src/worktree.js';
import { IDENTITY, tempRepo, type TempRepo } from '../src/fake/repo.js';

describe('worktree', () => {
  let repo: TempRepo;
  let wt: WorktreePort;

  beforeAll(async () => {
    repo = await tempRepo();
    wt = createWorktrees({
      root: repo.userData,
      ref: { owner: 'acme', repo: 'widget' },
      cloneUrl: repo.remote,
      identity: IDENTITY,
    });
  });

  it('clone, worktree sur une branche neuve, commit, push, jamais --force', async () => {
    expect(wt.has(7)).toBe(false);
    expect(wt.list()).toEqual([]);
    expect(await wt.open(7)).toBeUndefined();
    const w = await wt.create(7, 'factory/7-un-titre', 'main');
    expect(w).toEqual({
      issue: 7,
      path: join(repo.userData, 'worktrees', 'acme-widget', '7'),
      branch: 'factory/7-un-titre',
    });
    expect(wt.has(7)).toBe(true);
    expect(wt.list()).toEqual([7]);
    expect(await wt.commitAll(w.path, 'rien')).toBeUndefined();
    writeFileSync(join(w.path, 'a.txt'), 'a\n');
    const sha = await wt.commitAll(w.path, 'feat(#7): a');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await wt.headSha(w.path)).toBe(sha);
    await wt.push(w.path, w.branch);
    expect(await repo.log('factory/7-un-titre')).toEqual(['feat(#7): a', 'chore: seed']);
    expect(await wt.create(7, 'factory/7-un-titre', 'main')).toEqual(w);
    expect(await wt.ensureClone()).toBe(join(repo.userData, 'repos', 'acme-widget'));
  });

  it('commit vide autorisé pour ouvrir la PR brouillon', async () => {
    const w = await wt.create(7, 'factory/7-un-titre', 'main');
    const sha = await wt.commitAll(w.path, 'chore(#7): ouverture', { allowEmpty: true });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('hasChangesUnder ne voit que le dossier demandé', async () => {
    const w = await wt.create(7, 'factory/7-un-titre', 'main');
    expect(await wt.hasChangesUnder(w.path, 'prototype/')).toBe(false);
    mkdirSync(join(w.path, 'prototype'), { recursive: true });
    writeFileSync(join(w.path, 'prototype', 'x.ts'), '// essai\n');
    expect(await wt.hasChangesUnder(w.path, 'prototype/')).toBe(true);
    expect(await wt.hasChangesUnder(w.path, 'docs/')).toBe(false);
  });

  it('remove supprime le dossier et la branche locale ; recréation depuis la branche distante', async () => {
    const path = join(repo.userData, 'worktrees', 'acme-widget', '7');
    await wt.remove(7);
    expect(existsSync(path)).toBe(false);
    await wt.remove(7);
    const again = await wt.create(7, 'factory/7-un-titre', 'main');
    expect(again.branch).toBe('factory/7-un-titre');
    expect(await repo.log('factory/7-un-titre')).toContain('feat(#7): a');
    expect(existsSync(join(again.path, 'a.txt'))).toBe(true);
  });

  it('branche de cadrage puis remplacement par la branche d’implémentation', async () => {
    const framing = await wt.create(8, 'framing/8', 'main');
    expect((await wt.open(8))?.branch).toBe('framing/8');
    expect(wt.list()).toEqual([7, 8]);
    await wt.remove(8);
    const impl = await wt.create(8, 'factory/8-slug', 'main');
    expect(impl.branch).toBe('factory/8-slug');
    await wt.remove(8);
    // Branche locale restée après un `worktree remove` manuel : reprise sans recréer.
    const git = (await import('simple-git')).simpleGit(await wt.ensureClone());
    await git.raw(['branch', 'factory/8-slug', 'origin/main']);
    expect((await wt.create(8, 'factory/8-slug', 'main')).branch).toBe('factory/8-slug');
    expect(framing.path).toBe(impl.path);
  });
});

describe('worktree — cas limites', () => {
  it('clone sans identité imposée, et remove tolère une branche introuvable (HEAD détachée)', async () => {
    const repo = await tempRepo();
    const wt = createWorktrees({
      root: repo.userData,
      ref: { owner: 'acme', repo: 'widget' },
      cloneUrl: repo.remote,
    });
    const w = await wt.create(9, 'factory/9-x', 'main');
    const { simpleGit } = await import('simple-git');
    await simpleGit(w.path).checkout(['--detach']);
    expect((await wt.open(9))?.branch).toBe('HEAD');
    await wt.remove(9);
    expect(wt.has(9)).toBe(false);
  });
});
