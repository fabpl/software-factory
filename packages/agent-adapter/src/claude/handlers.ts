import {
  AGENT_EVIDENCE_STATES,
  isBlocking,
  validateCardInput,
  type AdrRequest,
  type CardAnswer,
  type CardInput,
  type ContractInput,
  type EvidenceInput,
  type FactoryToolName,
} from '@factory/conventions';
import type { FactoryToolHandlers } from '../events.js';
import type { RunState } from './state.js';

/** Ce que le modèle lit en retour d'un outil `factory`. */
export type ToolText = Promise<string>;

export interface WrappedHandlers {
  emit_card(input: CardInput): ToolText;
  update_contract(input: ContractInput): ToolText;
  update_evidence(input: EvidenceInput): ToolText;
  request_adr(input: AdrRequest): ToolText;
  read_rules(): ToolText;
}

export const CARD_PUBLISHED_STOP = "Carte publiée, le run s'arrête. Ne fais aucun autre appel.";

export function answerText(answer: CardAnswer): string {
  const choice = answer.choice.kind === 'option' ? answer.choice.letter : answer.choice.kind;
  return answer.text === '' ? choice : `${choice}. ${answer.text}`;
}

/**
 * Enveloppe les handlers de l'orchestrateur : observe chaque appel (file d'événements),
 * applique les invariants que l'agent ne doit pas pouvoir contourner, et formule la réponse au modèle.
 */
export function wrapHandlers(tools: FactoryToolHandlers, state: RunState): WrappedHandlers {
  const { runId } = state;
  return {
    async emit_card(card) {
      const valid = validateCardInput(card);
      if (!valid.ok) return `Carte refusée (${JSON.stringify(valid.error)}). Corrige et réémets.`;
      const { cardId } = await tools.emit_card(card);
      const blocking = isBlocking(card.kind);
      state.queue.push({ type: 'card.emitted', runId, card, blocking });
      if (!blocking) return `Carte ${cardId} publiée (décision réversible). Continue.`;
      state.stopOnCard = cardId;
      return CARD_PUBLISHED_STOP;
    },
    async update_contract(input) {
      await tools.update_contract(input);
      state.queue.push({ type: 'contract.updated', runId, contract: input });
      return `Contrat réécrit : ${String(input.items.length)} items.`;
    },
    async update_evidence(input) {
      const forbidden = input.lines.filter((l) => !AGENT_EVIDENCE_STATES.includes(l.state));
      if (forbidden.length > 0) {
        const list = forbidden.map((l) => `${l.criterion} (${l.state})`).join(', ');
        return `Refusé : l'agent n'écrit que pending, to-review ou blocked. Lignes en cause : ${list}.`;
      }
      await tools.update_evidence(input);
      state.queue.push({ type: 'evidence.updated', runId, evidence: input });
      return `Preuves réécrites : ${String(input.lines.length)} lignes.`;
    },
    async request_adr(input) {
      await tools.request_adr(input);
      state.queue.push({ type: 'adr.requested', runId, adr: input });
      return `ADR demandé pour la carte ${input.cardId} (${input.slug}).`;
    },
    async read_rules() {
      const rules = await tools.read_rules();
      return rules.trim() === '' ? 'Aucune règle enregistrée pour ce dépôt.' : rules;
    },
  };
}

export const HANDLER_NAMES: readonly FactoryToolName[] = [
  'emit_card',
  'update_contract',
  'update_evidence',
  'request_adr',
  'read_rules',
];
