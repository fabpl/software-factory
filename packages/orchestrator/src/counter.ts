import {
  err,
  incrementCounter,
  ok,
  parseCounter,
  type CounterError,
  type Result,
} from '@factory/conventions';
import type { GitHubPort } from './github.js';

/**
 * `pnpm factory counter add "raison"` : incrémente le compteur de `README.md` et le commite
 * directement sur la branche par défaut. Seule écriture sur la branche par défaut
 * (SPEC-orchestrator, Limites) ; sha attendu, aucune nouvelle tentative.
 */

export const COUNTER_FILE = 'README.md';

export type CounterAddError =
  CounterError | { kind: 'missing-readme'; branch: string } | { kind: 'stale'; branch: string };

export async function addToCounter(
  github: GitHubPort,
  reason: string,
): Promise<Result<{ value: number; commit: string }, CounterAddError>> {
  const branch = await github.defaultBranch();
  const file = await github.readFile(COUNTER_FILE, branch);
  if (!file) return err({ kind: 'missing-readme', branch });
  const current = parseCounter(file.content);
  if (!current.ok) return current;
  const next = incrementCounter(file.content, reason);
  if (!next.ok) return next;
  const value = current.value.value + 1;
  const commit = await github.commitFile({
    path: COUNTER_FILE,
    branch,
    content: next.value,
    sha: file.sha,
    message: `docs(readme): compteur ${String(value)} — ${reason.trim()}`,
  });
  if (commit.kind === 'stale') return err({ kind: 'stale', branch });
  return ok({ value, commit: commit.sha });
}

function describe(error: CounterAddError): string {
  switch (error.kind) {
    case 'missing-readme':
      return `${COUNTER_FILE} absent de la branche ${error.branch}`;
    case 'stale':
      return `${COUNTER_FILE} a changé sur ${error.branch} entre lecture et écriture : rien n'est écrit, relance la commande`;
    case 'empty-reason':
      return 'raison vide';
    case 'multiline-reason':
      return 'la raison tient sur une ligne';
    default:
      return `compteur illisible dans ${COUNTER_FILE} : ${JSON.stringify(error)}`;
  }
}

/** Code de sortie de `factory counter <sous-commande>`. */
export async function counterCommand(
  github: GitHubPort,
  args: readonly string[],
  io: { log: (s: string) => void; error: (s: string) => void },
): Promise<number> {
  if (args[0] !== 'add') {
    io.error('usage : factory counter add "raison"');
    return 2;
  }
  const result = await addToCounter(github, args.slice(1).join(' '));
  if (!result.ok) {
    io.error(describe(result.error));
    return 1;
  }
  io.log(`Compteur : ${String(result.value.value)} (commit ${result.value.commit})`);
  return 0;
}
