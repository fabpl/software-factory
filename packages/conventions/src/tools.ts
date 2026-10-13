import type { AdrInput } from './adr.js';
import type { Contract } from './contract.js';
import type { Evidence } from './evidence.js';

/**
 * Vocabulaire des outils que l'orchestrateur expose aux skills (SPEC-skills, « Outils requis »).
 * Partagé par `skills` (front matter `requires_tools`) et `agent-adapter` (serveur MCP `factory`).
 */
export const FACTORY_TOOL_NAMES = [
  'emit_card',
  'update_contract',
  'update_evidence',
  'request_adr',
  'read_rules',
] as const;
export type FactoryToolName = (typeof FACTORY_TOOL_NAMES)[number];

export function isFactoryToolName(name: string): name is FactoryToolName {
  return (FACTORY_TOOL_NAMES as readonly string[]).includes(name);
}

/** Ce que l'agent fournit à `update_contract` ; l'orchestrateur ajoute version et skill. */
export type ContractInput = Pick<Contract, 'items'>;

/** Ce que l'agent fournit à `update_evidence` ; l'orchestrateur ajoute contract et skill. */
export type EvidenceInput = Pick<Evidence, 'lines'>;

/** Ce que l'agent fournit à `request_adr` ; l'orchestrateur réserve le numéro, la date et le statut. */
export type AdrRequest = Omit<AdrInput, 'number' | 'date' | 'status'> & { cardId: string };
