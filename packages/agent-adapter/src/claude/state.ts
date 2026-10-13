import type { FactoryEvent } from '../events.js';

/**
 * État partagé d'un run entre les hooks, les handlers d'outils et la traduction.
 * Vit le temps d'un `start` ou d'un `resume`.
 */
export class RunState {
  /** Appels d'outil vus dans un message assistant, en attente de leur `tool_result`. */
  readonly toolUses = new Map<string, { name: string; input: unknown }>();
  /** Événements produits par les handlers pendant un tour, drainés par l'adaptateur. */
  readonly queue: FactoryEvent[] = [];
  /** Une carte bloquante a été publiée par le handler : le tour en cours est le dernier du run. */
  stopOnCard: string | undefined;
  sessionId: string | undefined;

  constructor(public readonly runId: string) {}

  drain(): FactoryEvent[] {
    return this.queue.splice(0, this.queue.length);
  }
}
