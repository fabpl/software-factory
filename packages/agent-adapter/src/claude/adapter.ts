import { query, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CardAnswer } from '@factory/conventions';
import type { AgentAdapter, FactoryEvent, RunSpec } from '../events.js';
import { answerText } from './handlers.js';
import { buildOptions } from './options.js';
import { RunState } from './state.js';
import { translate, type SdkMessageLike } from './translate.js';

export interface ClaudeCodeAdapterOptions {
  /** Flux `SDKMessage` brut, pour le journal JSONL de la salle des machines. */
  onMessage?: (runId: string, message: SDKMessage) => void;
  /** Sortie d'erreur du processus Claude Code, ligne par ligne (diagnostic). */
  onStderr?: (runId: string, line: string) => void;
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
    return this.run(spec, spec.prompt);
  }

  resume(spec: RunSpec, answer: CardAnswer): AsyncIterable<FactoryEvent> {
    // Reprise ordinaire de la session : la réponse voyage dans le prompt, aucun outil n'est rejoué.
    const prompt = `Réponse de l'humain à la carte ${answer.cardId} : ${answerText(answer)}\n\n${spec.prompt}`;
    return this.run(spec, prompt);
  }

  async cancel(runId: string): Promise<void> {
    const active = this.runs.get(runId);
    if (!active) return;
    active.controller.abort();
    active.query.close();
    await Promise.resolve();
  }

  private async *run(spec: RunSpec, prompt: string): AsyncIterable<FactoryEvent> {
    const state = new RunState(spec.runId);
    if (spec.sessionId !== undefined) state.sessionId = spec.sessionId;
    const controller = new AbortController();
    const options = buildOptions(spec, state, controller);
    const onStderr = this.options.onStderr;
    if (onStderr) {
      options.stderr = (data: string) => {
        for (const line of data.split('\n')) if (line.trim() !== '') onStderr(spec.runId, line);
      };
    }
    const q = query({ prompt, options });
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
        if (state.stopOnCard !== undefined && callsTool(msg)) {
          // L'agent a ignoré « Carte publiée, le run s'arrête » : on coupe avant l'appel.
          const cardId = state.stopOnCard;
          state.stopOnCard = undefined;
          q.close();
          yield waiting(cardId);
          break;
        }
        const events = translate(msg, state, ctx);
        for (const event of events) {
          if (event.type === 'run.finished' && state.stopOnCard !== undefined) {
            // Carte bloquante publiée pendant ce tour : la fin normale du tour vaut mise en attente.
            const cardId = state.stopOnCard;
            state.stopOnCard = undefined;
            state.sessionId = event.sessionId;
            yield waiting(cardId);
            break;
          }
          if (event.type === 'run.failed' || event.type === 'run.finished') terminated = true;
          yield event;
        }
        yield* state.drain();
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

/** Un message `assistant` qui contient au moins un `tool_use`. */
function callsTool(msg: SdkMessageLike): boolean {
  if (msg.type !== 'assistant') return false;
  const content = (msg as { message?: { content?: unknown } }).message?.content;
  return Array.isArray(content) && content.some((b: { type?: string }) => b.type === 'tool_use');
}
