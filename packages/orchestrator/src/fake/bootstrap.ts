import { join } from 'node:path';
import type { BootstrapOptions } from '../bootstrap.js';
import { createLog } from '../log.js';
import { Orchestrator } from '../orchestrator.js';
import { createWorktrees } from '../worktree.js';
import { RoutedAdapter } from './adapter.js';
import { greenCiForOpenHeads } from './ci.js';
import scenarios from './full-loop.json' with { type: 'json' };
import { FakeGitHub } from './github.js';
import { IDENTITY, tempRepo, type TempRepo } from './repo.js';

/**
 * Mode `fake` (H1) : l'orchestrateur réel branché sur un GitHub en mémoire, le scénario
 * `full-loop.json`, un `origin` nu et un `userData` créés sous `os.tmpdir()`, la CI verte dès
 * lecture (D3). Ni `gh`, ni réseau, ni `FACTORY_REPO`.
 */

export const FAKE_TICK_MS = 500;

export interface FakeSetup {
  orchestrator: Orchestrator;
  github: FakeGitHub;
  repo: TempRepo;
}

export async function createFake(): Promise<FakeSetup> {
  const repo = await tempRepo();
  const github = new FakeGitHub({ ciRule: greenCiForOpenHeads });
  // H3 : une intention prête, pour que « Lancer le cadrage » soit offert dès le premier état.
  github.addIssue({
    number: 1,
    title: 'Lire les étiquettes sans Project',
    body: 'Je veux que l’app lise les étiquettes sans configurer un Project.\n',
    labels: ['phase:intent'],
  });
  const orchestrator = new Orchestrator({
    github,
    adapter: new RoutedAdapter(scenarios as ConstructorParameters<typeof RoutedAdapter>[0]),
    worktrees: createWorktrees({
      root: repo.userData,
      ref: github.ref,
      cloneUrl: repo.remote,
      identity: IDENTITY,
    }),
    log: createLog(join(repo.userData, 'logs')),
    tickIntervalMs: FAKE_TICK_MS,
  });
  return { orchestrator, github, repo };
}

/**
 * Se substitue à `bootstrap()` dans l'app ; ses options (dossier maison, dépôt) sont ignorées :
 * tout s'écrit sous le dossier temporaire de `tempRepo()` (C7).
 */
export const bootstrapFake: (options?: BootstrapOptions) => Promise<Orchestrator> = async () =>
  (await createFake()).orchestrator;
