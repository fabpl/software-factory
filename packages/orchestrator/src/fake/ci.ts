import type { CiRun, PullData } from '../github.js';

/** Règle de CI d'un `FakeGitHub` : le run le plus récent pour ce SHA, vu les PR du dépôt. */
export type CiRule = (sha: string, pulls: readonly PullData[]) => CiRun | undefined;

/**
 * Mode `fake` (D3) : la CI est verte dès qu'on la lit pour la tête de toute PR ouverte, sans
 * étape `in_progress` ; aucun run pour un autre SHA.
 */
export const greenCiForOpenHeads: CiRule = (sha, pulls) =>
  pulls.some((p) => p.state === 'open' && p.headSha === sha)
    ? {
        url: `https://github.test/acme/widget/actions/runs/${sha}`,
        status: 'completed',
        conclusion: 'success',
      }
    : undefined;
