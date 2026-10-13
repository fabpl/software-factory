import { execFile } from 'node:child_process';
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

function notReady(error: unknown): GhNotReady {
  const code = (error as { code?: string }).code;
  if (code === 'ENOENT') {
    return {
      kind: 'gh-not-ready',
      command: 'brew install gh && gh auth login',
      detail: '`gh` est introuvable',
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'gh-not-ready', command: 'gh auth login', detail: message.trim() };
}

/** `gh auth token` : le jeton du compte connecté. */
export async function ghToken(exec: Exec = defaultExec): Promise<Result<string, GhNotReady>> {
  try {
    const { stdout } = await exec('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (token === '')
      return err({ kind: 'gh-not-ready', command: 'gh auth login', detail: 'jeton vide' });
    return ok(token);
  } catch (error) {
    return err(notReady(error));
  }
}

/** `gh auth status` puis `gh auth setup-git` : git doit pouvoir pousser avec le compte de `gh`. */
export async function ghReady(exec: Exec = defaultExec): Promise<Result<true, GhNotReady>> {
  try {
    await exec('gh', ['auth', 'status']);
  } catch (error) {
    return err(notReady(error));
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
