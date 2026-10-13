import type { CardAnswer, CardInput } from '@factory/conventions';
import { wrapHandlers, type WrappedHandlers } from '../claude/handlers.js';
import { RunState } from '../claude/state.js';
import { isTerminal, type AgentAdapter, type FactoryEvent, type RunSpec } from '../events.js';

/** Un pas de scénario : soit un événement brut (sans `runId`), soit un appel d'outil `factory`. */
export type ScenarioStep =
  | { event: DistributiveOmit<FactoryEvent, 'runId'> }
  | { tool: 'emit_card'; input: CardInput }
  | { tool: 'update_contract'; input: Parameters<WrappedHandlers['update_contract']>[0] }
  | { tool: 'update_evidence'; input: Parameters<WrappedHandlers['update_evidence']>[0] }
  | { tool: 'request_adr'; input: Parameters<WrappedHandlers['request_adr']>[0] }
  | { tool: 'read_rules' };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface Scenario {
  /** Pas joués par `start`. */
  start: ScenarioStep[];
  /** Pas joués par chaque `resume` successif. */
  resume?: ScenarioStep[][];
}

const FAKE_SESSION = 'fake-session';

/**
 * Rejoue un scénario JSON en appelant les vrais handlers de `spec.tools` via la même enveloppe que
 * l'adaptateur Claude : contraint le cœur à ne dépendre que de `FactoryEvent`.
 */
export class FakeAdapter implements AgentAdapter {
  readonly id = 'fake' as const;
  /** Réponses reçues par `resume`, dans l'ordre, pour les assertions des tests du cœur. */
  readonly answers: CardAnswer[] = [];
  private readonly cancelled = new Set<string>();

  constructor(private readonly scenario: Scenario) {}

  start(spec: RunSpec): AsyncIterable<FactoryEvent> {
    return this.play(spec, this.scenario.start);
  }

  /** La réponse n'est pas rejouée : comme pour l'adaptateur réel, la carte répondue n'est pas republiée. */
  resume(spec: RunSpec, answer: CardAnswer): AsyncIterable<FactoryEvent> {
    this.answers.push(answer);
    const steps = this.scenario.resume?.[this.answers.length - 1] ?? [];
    return this.play(spec, steps);
  }

  cancel(runId: string): Promise<void> {
    this.cancelled.add(runId);
    return Promise.resolve();
  }

  private async *play(spec: RunSpec, steps: ScenarioStep[]): AsyncIterable<FactoryEvent> {
    const state = new RunState(spec.runId);
    state.sessionId = spec.sessionId ?? FAKE_SESSION;
    const handlers = wrapHandlers(spec.tools, state);
    const sessionId = state.sessionId;
    yield {
      type: 'run.started',
      runId: spec.runId,
      sessionId,
      model: 'fake',
      tools: spec.requiredTools.map((t) => `mcp__factory__${t}`),
    };
    let turns = 0;
    for (const step of steps) {
      turns += 1;
      if (this.cancelled.has(spec.runId)) {
        yield { type: 'run.failed', runId: spec.runId, sessionId, reason: 'cancelled', detail: '' };
        return;
      }
      if ('event' in step) {
        const event: FactoryEvent = { ...step.event, runId: spec.runId };
        yield event;
        if (isTerminal(event)) return;
        continue;
      }
      const summary = await callTool(handlers, step);
      yield { type: 'agent.tool', runId: spec.runId, tool: step.tool, summary, ok: true };
      yield* state.drain();
      if (state.stopOnCard !== undefined) {
        yield { type: 'run.waiting', runId: spec.runId, sessionId, cardId: state.stopOnCard };
        return;
      }
    }
    yield { type: 'run.finished', runId: spec.runId, sessionId, turns, costUsd: 0 };
  }
}

async function callTool(
  handlers: WrappedHandlers,
  step: Exclude<ScenarioStep, { event: unknown }>,
): Promise<string> {
  switch (step.tool) {
    case 'emit_card':
      return handlers.emit_card(step.input);
    case 'update_contract':
      return handlers.update_contract(step.input);
    case 'update_evidence':
      return handlers.update_evidence(step.input);
    case 'request_adr':
      return handlers.request_adr(step.input);
    case 'read_rules':
      return handlers.read_rules();
  }
}
