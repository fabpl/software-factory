import { serializeContract, type Contract } from '@factory/conventions';
import type { Skill } from './skill.js';

export interface InjectInput {
  skill: Skill;
  /** Absent au premier run de cadrage. */
  contract?: Contract;
  /** Contenu de `.factory/rules.md` du dépôt cible, vide si absent. */
  rules?: string;
}

export const SINGLE_CALL_RULE =
  "Quand tu émets une carte `question`, `arbitration` ou `action`, l'appel à `emit_card` est le seul appel d'outil de ton tour : rien avant, rien après. Le run s'arrête et reprend avec la réponse.";

/** Assemble les instructions d'un run : skill, puis contrat, puis règles du projet. */
export function inject({ skill, contract, rules }: InjectInput): string {
  const parts = [
    skill.body.trim(),
    '## Règle d’exécution\n\n' + SINGLE_CALL_RULE,
    '## Contrat actuel\n\n' +
      (contract ? serializeContract(contract) : 'Aucun contrat : le run de cadrage le crée.'),
    '## Règles du projet (`.factory/rules.md`)\n\n' +
      (rules && rules.trim() !== '' ? rules.trim() : 'Aucune règle enregistrée.'),
  ];
  return parts.join('\n\n') + '\n';
}
