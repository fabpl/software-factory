import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { RepoRef } from './github.js';

/**
 * Worktrees et branches (SPEC-orchestrator, « Worktrees et branches »). Tout passe par `simple-git`.
 * Jamais de `push --force` ; `worktree remove --force` et `branch -D` ne touchent que le disque local.
 */

export interface Worktree {
  issue: number;
  path: string;
  branch: string;
}

export interface WorktreePort {
  readonly root: string;
  /** `<root>/repos/<owner>-<repo>`, qu'il soit déjà cloné ou non. */
  readonly clonePath: string;
  /** Clone principal `<root>/repos/<owner>-<repo>` : cloné s'il manque, sinon `fetch --prune`. */
  ensureClone(): Promise<string>;
  /** `<root>/worktrees/<owner>-<repo>/<issue>` sur `branch`, créée depuis `origin/<base>` si elle n'existe nulle part. */
  create(issue: number, branch: string, base: string): Promise<Worktree>;
  open(issue: number): Promise<Worktree | undefined>;
  has(issue: number): boolean;
  /** Issues ayant un worktree sur le disque. */
  list(): number[];
  /** Supprime le worktree et sa branche locale. La branche distante n'est jamais touchée. */
  remove(issue: number): Promise<void>;
  /** `git add -A` + commit ; `undefined` si rien à committer (sauf `allowEmpty`). */
  commitAll(
    path: string,
    message: string,
    options?: { allowEmpty?: boolean },
  ): Promise<string | undefined>;
  push(path: string, branch: string): Promise<void>;
  /** Modifications non committées sous `dir` (fichiers nouveaux compris). */
  hasChangesUnder(path: string, dir: string): Promise<boolean>;
  headSha(path: string): Promise<string>;
}

export interface WorktreeOptions {
  root: string;
  ref: RepoRef;
  cloneUrl: string;
  /** Identité de commit à poser sur le clone (tests, CI). Absente = identité git de la machine. */
  identity?: { name: string; email: string };
}

export function createWorktrees(options: WorktreeOptions): WorktreePort {
  const slug = `${options.ref.owner}-${options.ref.repo}`;
  const clonePath = join(options.root, 'repos', slug);
  const worktreePath = (issue: number): string =>
    join(options.root, 'worktrees', slug, String(issue));

  async function ensureClone(): Promise<string> {
    if (existsSync(join(clonePath, '.git'))) {
      await simpleGit(clonePath).fetch(['origin', '--prune']);
      return clonePath;
    }
    mkdirSync(join(options.root, 'repos'), { recursive: true });
    await simpleGit().clone(options.cloneUrl, clonePath);
    if (options.identity) {
      const git = simpleGit(clonePath);
      await git.addConfig('user.name', options.identity.name);
      await git.addConfig('user.email', options.identity.email);
    }
    return clonePath;
  }

  async function open(issue: number): Promise<Worktree | undefined> {
    const path = worktreePath(issue);
    if (!existsSync(path)) return undefined;
    const branch = (await simpleGit(path).revparse(['--abbrev-ref', 'HEAD'])).trim();
    return { issue, path, branch };
  }

  async function create(issue: number, branch: string, base: string): Promise<Worktree> {
    const existing = await open(issue);
    if (existing) return existing;
    const git: SimpleGit = simpleGit(await ensureClone());
    const path = worktreePath(issue);
    mkdirSync(join(options.root, 'worktrees', slug), { recursive: true });
    const remote = (await git.branch(['-r', '--list', `origin/${branch}`])).all.length > 0;
    const local = (await git.branch(['--list', branch])).all.length > 0;
    if (local) await git.raw(['worktree', 'add', path, branch]);
    else if (remote)
      await git.raw(['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`]);
    else await git.raw(['worktree', 'add', '-b', branch, path, `origin/${base}`]);
    return { issue, path, branch };
  }

  async function remove(issue: number): Promise<void> {
    const existing = await open(issue);
    if (!existing) return;
    const git = simpleGit(clonePath);
    await git.raw(['worktree', 'remove', '--force', existing.path]);
    await git.raw(['branch', '-D', existing.branch]).catch(() => undefined);
  }

  async function commitAll(
    path: string,
    message: string,
    opts: { allowEmpty?: boolean } = {},
  ): Promise<string | undefined> {
    const git = simpleGit(path);
    await git.add(['-A']);
    const status = await git.status();
    if (status.isClean() && opts.allowEmpty !== true) return undefined;
    await git.commit(message, opts.allowEmpty === true ? ['--allow-empty'] : []);
    return (await git.revparse(['HEAD'])).trim();
  }

  async function push(path: string, branch: string): Promise<void> {
    await simpleGit(path).push(['-u', 'origin', branch]);
  }

  async function hasChangesUnder(path: string, dir: string): Promise<boolean> {
    const out = await simpleGit(path).raw(['status', '--porcelain', '--', dir]);
    return out.trim() !== '';
  }

  async function headSha(path: string): Promise<string> {
    return (await simpleGit(path).revparse(['HEAD'])).trim();
  }

  return {
    root: options.root,
    clonePath,
    ensureClone,
    create,
    open,
    has: (issue) => existsSync(worktreePath(issue)),
    list: () => {
      const dir = join(options.root, 'worktrees', slug);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .sort((a, b) => a - b);
    },
    remove,
    commitAll,
    push,
    hasChangesUnder,
    headSha,
  };
}
