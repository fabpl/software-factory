/**
 * `pnpm --filter @factory/orchestrator live` : lecture seule contre le vrai dépôt, hors CI.
 * Vérifie le critère « un tick sans changement consomme zéro appel comptabilisé » : la seconde
 * lecture ne doit produire que des 304.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bootstrap, type OctokitGitHub } from '../src/index.js';

async function main(): Promise<void> {
  const orchestrator = await bootstrap({
    userData: process.env.FACTORY_HOME ?? join(homedir(), '.software-factory'),
  });
  const first = await orchestrator.observe();
  if (first.status === 'blocked') {
    console.log(
      `bloqué : ${first.blockedReason?.message ?? ''} → ${first.blockedReason?.command ?? ''}`,
    );
    process.exit(1);
  }
  // L'orchestrateur ne rend pas son port GitHub : on relit les statistiques via le module.
  const github = (orchestrator as unknown as { options: { github: OctokitGitHub } }).options.github;
  const afterFirst = { ...github.stats };
  const second = await orchestrator.observe();
  const afterSecond = { ...github.stats };
  console.log(
    `tâches : ${String(first.tasks.length)} ; erreurs : ${first.errors.join(', ') || 'aucune'}`,
  );
  console.log(
    `première lecture : ${String(afterFirst.requests)} requêtes comptabilisées, ${String(afterFirst.notModified)} × 304`,
  );
  console.log(
    `seconde lecture  : ${String(afterSecond.requests - afterFirst.requests)} requêtes comptabilisées, ${String(afterSecond.notModified - afterFirst.notModified)} × 304`,
  );
  const ok = afterSecond.requests === afterFirst.requests && second.errors.length === 0;
  console.log(
    ok
      ? 'OK : zéro appel comptabilisé sur la seconde lecture'
      : 'ÉCHEC : des appels ont été comptabilisés',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
