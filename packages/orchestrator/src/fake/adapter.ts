import type { CardAnswer } from '@factory/conventions';
import {
  FakeAdapter,
  type AgentAdapter,
  type FactoryEvent,
  type RunSpec,
  type Scenario,
} from '@factory/agent-adapter';

/**
 * Deux `FakeAdapter`, un par skill, derrière une seule interface `AgentAdapter` :
 * le scénario complet enchaîne un run de cadrage et un run d'implémentation.
 */
export class RoutedAdapter implements AgentAdapter {
  readonly id = 'fake' as const;
  readonly framing: FakeAdapter;
  readonly implementation: FakeAdapter;
  readonly cancelled: string[] = [];

  constructor(scenarios: { framing: Scenario; implementation: Scenario }) {
    this.framing = new FakeAdapter(scenarios.framing);
    this.implementation = new FakeAdapter(scenarios.implementation);
  }

  private route(spec: RunSpec): FakeAdapter {
    return spec.requiredTools.includes('update_contract') ? this.framing : this.implementation;
  }

  start(spec: RunSpec): AsyncIterable<FactoryEvent> {
    return this.route(spec).start(spec);
  }

  resume(spec: RunSpec, answer: CardAnswer): AsyncIterable<FactoryEvent> {
    return this.route(spec).resume(spec, answer);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
    await this.framing.cancel(runId);
    await this.implementation.cancel(runId);
  }
}
