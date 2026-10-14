import type { BootstrapOptions, InboxState, Orchestrator } from '@factory/orchestrator';
import type { OrchestratorCommands } from '../shared/api';

/** Ce que le process principal attend d'un orchestrateur : commandes, lecture, cycle de vie. */
export type OrchestratorPort = Pick<Orchestrator, 'subscribe' | 'getState' | 'start' | 'stop'> &
  OrchestratorCommands;

export type Bootstrap = (options: BootstrapOptions) => Promise<OrchestratorPort>;

export interface RuntimeOptions {
  bootstrap: Bootstrap;
  /** Dossier maison résolu par `resolveHome` (H7). */
  home: string;
  /** `owner/repo` ; sinon `bootstrap()` détecte le dépôt via `gh repo view`. */
  repo?: string;
}

type Listener = (state: InboxState) => void;

/**
 * Orchestrateur courant du process principal. `retry()` (H8) rappelle `bootstrap()`, arrête
 * l'ancien, remplace et rebranche les abonnés : le renderer ne voit qu'un seul flux d'états.
 */
export interface Runtime {
  current(): OrchestratorPort;
  getState(): InboxState;
  subscribe(listener: Listener): () => void;
  retry(): Promise<void>;
  /** Arrêt à la fermeture de l'app : annule le run en cours (≤ 10 s). */
  stop(): Promise<void>;
}

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const listeners = new Set<Listener>();
  const boot = (): Promise<OrchestratorPort> =>
    options.bootstrap({
      userData: options.home,
      ...(options.repo !== undefined ? { repo: options.repo } : {}),
    });

  let orchestrator = await boot();
  let unsubscribe = attach(orchestrator);

  function attach(target: OrchestratorPort): () => void {
    return target.subscribe((state) => {
      for (const l of listeners) l(state);
    });
  }

  return {
    current: () => orchestrator,
    getState: () => orchestrator.getState(),
    subscribe(listener) {
      listeners.add(listener);
      listener(orchestrator.getState());
      return () => {
        listeners.delete(listener);
      };
    },
    async retry() {
      unsubscribe();
      await orchestrator.stop();
      orchestrator = await boot();
      unsubscribe = attach(orchestrator);
      orchestrator.start();
    },
    stop: () => orchestrator.stop(),
  };
}
