import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export interface TempRepo {
  dir: string;
  /** Dépôt nu qui joue le rôle d'`origin`. */
  remote: string;
  /** Racine `userData` pour les worktrees. */
  userData: string;
  log(branch: string): Promise<string[]>;
}

export const IDENTITY = { name: 'Factory Test', email: 'factory@test.invalid' };

/** Un `origin` nu avec un commit sur `main`, et une racine `userData` vide. */
export async function tempRepo(): Promise<TempRepo> {
  const dir = mkdtempSync(join(tmpdir(), 'factory-'));
  const remote = join(dir, 'remote.git');
  const seed = join(dir, 'seed');
  await simpleGit().raw(['init', '--bare', remote]);
  await simpleGit(remote).raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await simpleGit().clone(remote, seed);
  const git = simpleGit(seed);
  await git.addConfig('user.name', IDENTITY.name);
  await git.addConfig('user.email', IDENTITY.email);
  await git.checkout(['-b', 'main']);
  writeFileSync(join(seed, 'README.md'), '# seed\n');
  await git.add(['-A']);
  await git.commit('chore: seed');
  await git.push(['-u', 'origin', 'main']);
  return {
    dir,
    remote,
    userData: join(dir, 'userData'),
    log: async (branch) =>
      (await simpleGit(remote).raw(['log', '--format=%s', branch]))
        .trim()
        .split('\n')
        .filter(Boolean),
  };
}
