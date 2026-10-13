import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ClaudeCodeAdapter } from '@factory/agent-adapter';
import { ghReady, ghToken } from './auth.js';
import type { RepoRef } from './github.js';
import { createLog } from './log.js';
import { createOctokitGitHub } from './octokit.js';
import { Orchestrator, type OrchestratorOptions } from './orchestrator.js';
import { createWorktrees } from './worktree.js';

/**
 * Assemble un orchestrateur réel : `gh` pour le jeton, Octokit, worktrees sous `userData`,
 * adaptateur Claude Code, journaux. Hors Electron : l'app et la CLI l'appellent tous deux.
 */

export interface BootstrapOptions {
  /** Dossier de données : worktrees, clones, journaux. */
  userData: string;
  /** `owner/repo` ; sinon `gh repo view` dans le dossier courant. */
  repo?: string;
  tickIntervalMs?: number;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

const exec = promisify(execFile);

export async function detectRepo(): Promise<RepoRef | undefined> {
  try {
    const { stdout } = await exec('gh', [
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '-q',
      '.nameWithOwner',
    ]);
    return parseRepo(stdout.trim());
  } catch {
    return undefined;
  }
}

export function parseRepo(slug: string): RepoRef | undefined {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(slug);
  return m ? { owner: String(m[1]), repo: String(m[2]) } : undefined;
}

export async function bootstrap(options: BootstrapOptions): Promise<Orchestrator> {
  const ready = await ghReady();
  const ref = (options.repo !== undefined ? parseRepo(options.repo) : await detectRepo()) ?? {
    owner: 'unknown',
    repo: 'unknown',
  };
  const slug = `${ref.owner}-${ref.repo}`;
  const log = createLog(join(options.userData, 'logs', slug));
  const sdkLog = createLog(join(options.userData, 'logs', slug, 'sdk'));
  log.purge();
  sdkLog.purge();

  const github = createOctokitGitHub({
    ref,
    token: async () => {
      const token = await ghToken();
      if (!token.ok) throw new Error(`${token.error.detail} (${token.error.command})`);
      return token.value;
    },
  });
  const orchestratorOptions: OrchestratorOptions = {
    github,
    adapter: new ClaudeCodeAdapter({
      onMessage: (runId, message) => {
        sdkLog.write(runId, { message });
      },
      onStderr: (runId, line) => {
        sdkLog.write(runId, { stderr: line });
      },
    }),
    worktrees: createWorktrees({ root: options.userData, ref, cloneUrl: github.cloneUrl() }),
    log,
    ...(options.tickIntervalMs !== undefined ? { tickIntervalMs: options.tickIntervalMs } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    ...(options.maxBudgetUsd !== undefined ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
  };
  if (!ready.ok) {
    return Orchestrator.blocked(
      { message: ready.error.detail, command: ready.error.command },
      orchestratorOptions,
    );
  }
  if (ref.owner === 'unknown') {
    return Orchestrator.blocked(
      {
        message: 'aucun dépôt GitHub détecté',
        command: 'pnpm factory --repo owner/repo <commande>',
      },
      orchestratorOptions,
    );
  }
  return new Orchestrator(orchestratorOptions);
}
