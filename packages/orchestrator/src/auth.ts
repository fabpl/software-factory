import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@factory/conventions';

/**
 * Authentification par `gh` (SPEC-orchestrator, « Prérequis d'exécution »). Aucun jeton n'est
 * stocké par l'app : il est relu à chaque démarrage et à chaque 401.
 */

export interface GhNotReady {
  kind: 'gh-not-ready';
  /** Commande à lancer pour débloquer, affichée dans la file Agir. */
  command: string;
  detail: string;
}

export type Exec = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: Exec = async (file, args) => {
  const { stdout, stderr } = await promisify(execFile)(file, args, { encoding: 'utf8' });
  return { stdout, stderr };
};

/** Ce que l'app voit de la machine quand `gh` est introuvable : son `PATH` et les fichiers présents. */
export interface GhEnv {
  path: string | undefined;
  home: string;
  exists: (file: string) => boolean;
}

const defaultEnv = (): GhEnv => ({ path: process.env.PATH, home: homedir(), exists: existsSync });

/** Emplacements où `gh` est cherché quand il manque au `PATH` de l'app. */
const ghLocations = (home: string): string[] => [
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  join(home, '.local/bin/gh'),
];

function notReady(error: unknown, env: GhEnv): GhNotReady {
  const code = (error as { code?: string }).code;
  if (code === 'ENOENT') {
    const path = env.path === undefined || env.path === '' ? '(vide)' : env.path;
    ghLocations(env.home).filter((file) => env.exists(file));
    return {
      kind: 'gh-not-ready',
      command: 'brew install gh && gh auth login',
      detail: `\`gh\` est introuvable ; PATH de l'app : ${path}`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'gh-not-ready', command: 'gh auth login', detail: message.trim() };
}

/** `gh auth token` : le jeton du compte connecté. */
export async function ghToken(
  exec: Exec = defaultExec,
  env: GhEnv = defaultEnv(),
): Promise<Result<string, GhNotReady>> {
  try {
    const { stdout } = await exec('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (token === '')
      return err({ kind: 'gh-not-ready', command: 'gh auth login', detail: 'jeton vide' });
    return ok(token);
  } catch (error) {
    return err(notReady(error, env));
  }
}

/** `gh auth status` puis `gh auth setup-git` : git doit pouvoir pousser avec le compte de `gh`. */
export async function ghReady(
  exec: Exec = defaultExec,
  env: GhEnv = defaultEnv(),
): Promise<Result<true, GhNotReady>> {
  try {
    await exec('gh', ['auth', 'status']);
  } catch (error) {
    return err(notReady(error, env));
  }
  try {
    const { stdout } = await exec('git', ['config', '--get-regexp', 'credential.*helper']);
    if (!stdout.includes('gh auth git-credential')) {
      return err({
        kind: 'gh-not-ready',
        command: 'gh auth setup-git',
        detail: 'git n’utilise pas `gh` comme credential helper',
      });
    }
  } catch {
    return err({
      kind: 'gh-not-ready',
      command: 'gh auth setup-git',
      detail: 'aucun credential helper git configuré',
    });
  }
  return ok(true);
}
