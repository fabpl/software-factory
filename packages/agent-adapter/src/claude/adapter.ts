import { query, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CardAnswer } from '@factory/conventions';
import type { AgentAdapter, FactoryEvent, RunSpec } from '../events.js';
import { answerText } from './handlers.js';
import { buildOptions } from './options.js';
import { RunState } from './state.js';
import { deferredCard, translate } from './translate.js';

export interface ClaudeCodeAdapterOptions {
  /** Flux `SDKMessage` brut, pour le journal JSONL de la salle des machines. */
  onMessage?: (runId: string, message: SDKMessage) => void;
}

interface ActiveRun {
  controller: AbortController;
  query: Query;
}

/** Pilote Claude Code en mode non interactif et traduit tout en `FactoryEvent`. */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code' as const;
  private readonly runs = new Map<string, ActiveRun>();

  constructor(private readonly options: ClaudeCodeAdapterOptions = {}) {}

  start(spec: RunSpec): AsyncIterable<FactoryEvent> {
    return this.run(spec, spec.prompt, undefined);
  }

  resume(spec: RunSpec, answer: CardAnswer): AsyncIterable<FactoryEvent> {
    // La réponse est à la fois armée dans le hook (rejeu de l'appel différé) et donnée dans le
    // prompt (repli close(), ou run neuf) : le modèle la voit dans tous les cas.
    const prompt = `Réponse de l'humain à la carte ${answer.cardId} : ${answerText(answer)}\n\n${spec.prompt}`;
    return this.run(spec, prompt, answer);
  }

  async cancel(runId: string): Promise<void> {
    const active = this.runs.get(runId);
    if (!active) return;
    active.controller.abort();
    active.query.close();
    await Promise.resolve();
  }

  private async *run(
    spec: RunSpec,
    prompt: string,
    answer: CardAnswer | undefined,
  ): AsyncIterable<FactoryEvent> {
    const state = new RunState(spec.runId);
    state.pendingAnswer = answer;
    if (spec.sessionId !== undefined) state.sessionId = spec.sessionId;
    const controller = new AbortController();
    const q = query({ prompt, options: buildOptions(spec, state, controller) });
    this.runs.set(spec.runId, { controller, query: q });
    const ctx = { requiredTools: spec.requiredTools };
    let terminated = false;

    const waiting = (cardId: string): FactoryEvent => {
      terminated = true;
      return { type: 'run.waiting', runId: spec.runId, sessionId: state.sessionId ?? '', cardId };
    };

    try {
      for await (const msg of q) {
        this.options.onMessage?.(spec.runId, msg);
        if (msg.type === 'result' && msg.subtype === 'success') {
          const deferred = deferredCard(msg);
          if (deferred) {
            if (!deferred.ok) {
              terminated = true;
              yield {
                type: 'run.failed',
                runId: spec.runId,
                sessionId: msg.session_id,
                reason: 'execution',
                detail: `carte différée invalide : ${deferred.error}`,
              };
              break;
            }
            const { cardId } = await spec.tools.emit_card(deferred.value);
            state.sessionId = msg.session_id;
            yield { type: 'card.emitted', runId: spec.runId, card: deferred.value, blocking: true };
            yield waiting(cardId);
            break;
          }
        }
        const events = translate(msg, state, ctx);
        for (const event of events) {
          if (event.type === 'run.failed' || event.type === 'run.finished') terminated = true;
          yield event;
        }
        yield* state.drain();
        if (state.stopOnCard !== undefined) {
          // Repli : le handler a publié la carte bloquante parce que l'agent a fait plusieurs appels.
          const cardId = state.stopOnCard;
          state.stopOnCard = undefined;
          q.close();
          yield waiting(cardId);
          break;
        }
        if (terminated) {
          if (events.some((e) => e.type === 'run.failed' && e.reason === 'tools_missing'))
            q.close();
          break;
        }
      }
    } catch (error) {
      if (!terminated) {
        terminated = true;
        const cancelled = controller.signal.aborted;
        yield {
          type: 'run.failed',
          runId: spec.runId,
          ...(state.sessionId !== undefined ? { sessionId: state.sessionId } : {}),
          reason: cancelled ? 'cancelled' : 'execution',
          detail: cancelled ? 'annulé' : String(error),
        };
      }
    } finally {
      this.runs.delete(spec.runId);
    }
    if (!terminated) {
      const cancelled = controller.signal.aborted;
      yield {
        type: 'run.failed',
        runId: spec.runId,
        ...(state.sessionId !== undefined ? { sessionId: state.sessionId } : {}),
        reason: cancelled ? 'cancelled' : 'execution',
        detail: cancelled ? 'annulé' : 'flux terminé sans résultat',
      };
    }
  }
}
