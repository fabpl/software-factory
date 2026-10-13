import type { CardAnswer } from '@factory/conventions';
import type { FactoryEvent } from '../events.js';

/**
 * État partagé d'un run entre les hooks, les handlers d'outils et la traduction.
 * Vit le temps d'un `start` ou d'un `resume`.
 */
export class RunState {
  /** Réponse humaine armée à la reprise ; consommée par le premier `emit_card` bloquant. */
  pendingAnswer: CardAnswer | undefined;
  /** Appels d'outil vus dans un message assistant, en attente de leur `tool_result`. */
  readonly toolUses = new Map<string, { name: string; input: unknown }>();
  /** Événements produits par les handlers pendant un tour, drainés par l'adaptateur. */
  readonly queue: FactoryEvent[] = [];
  /** Repli : une carte bloquante a été publiée par le handler (pas de `defer`) ; le run doit s'arrêter. */
  stopOnCard: string | undefined;
  sessionId: string | undefined;
  /** Reprise : l'appel différé n'a pas pu être rejoué, la réponse est passée par le prompt. */
  deferredUnavailable = false;

  constructor(public readonly runId: string) {}

  takeAnswer(): CardAnswer | undefined {
    const answer = this.pendingAnswer;
    this.pendingAnswer = undefined;
    return answer;
  }

  drain(): FactoryEvent[] {
    return this.queue.splice(0, this.queue.length);
  }
}
