import { join } from 'node:path';

/**
 * Dossier maison de la factory (H7) : `FACTORY_HOME`, sinon `~/.software-factory`. Même résolution
 * que `packages/orchestrator/src/cli.ts` ; jamais `app.getPath('userData')`, pour qu'app et CLI
 * partagent clones, worktrees et journaux.
 */
export function resolveHome(env: Record<string, string | undefined>, homedir: string): string {
  return env.FACTORY_HOME ?? join(homedir, '.software-factory');
}
