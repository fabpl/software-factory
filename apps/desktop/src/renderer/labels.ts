import type { CardOrigin, Reversibility } from '@factory/conventions';
import type { CardView } from '@factory/orchestrator';

/**
 * Libellés de l'écran (SPEC-inbox, « Langue et libellés ») : tout jeton machine affiché passe par
 * ce dictionnaire, aucun jeton anglais n'apparaît à l'écran.
 */
export const LABELS = {
  connecting: 'Connexion à l’orchestrateur…',
  blockedTitle: 'Prérequis manquant',
  blockedHint: 'Lance cette commande dans un terminal, puis réessaie.',
  copy: 'Copier',
  copied: 'Copié',
  retry: 'Réessayer',
  retrying: 'Réessai…',
  lastSync: 'Dernière synchronisation',
  empty: 'Rien à faire ici',
  recommended: 'Recommandé',
  changeCost: 'Coût d’un changement d’avis',
  reversibility: 'Réversibilité',
  origin: 'Origine',
  skill: 'Skill',
  openInGitHub: 'Ouvrir dans GitHub',
  openArtifact: 'Voir l’artefact',
  note: 'Note',
  answer: 'Réponse',
  other: 'Autre',
  keep: 'Garder',
  reverse: 'Renverser',
  shouldHaveBlocked: 'Ça aurait dû me bloquer',
  validate: 'Valider',
  reject: 'Rejeter',
  discuss: 'À discuter',
  proven: 'Prouvé',
  blocked: 'Bloqué',
  done: 'C’est fait',
  sent: 'Envoyé, l’agent reprend',
  sendFailed: 'Échec de l’envoi',
  issue: (n: number) => `#${String(n)}`,
} as const;

/** Phrase ajoutée au texte d'un désaveu quand la case est cochée (détectée par `shouldHaveBlocked`). */
export const SHOULD_HAVE_BLOCKED_TEXT = 'Ça aurait dû me bloquer.';

export const QUEUE_LABELS = {
  arbitrate: 'Arbitrer',
  validate: 'Valider',
  act: 'Agir',
} as const;

export type QueueName = keyof typeof QUEUE_LABELS;

export const KIND_LABELS: Record<CardView['kind'], string> = {
  question: 'Question',
  arbitration: 'Arbitrage',
  decision: 'Décision',
  action: 'Action',
  item: 'Item de contrat',
  evidence: 'Preuve à examiner',
};

export const REVERSIBILITY_LABELS: Record<Reversibility, string> = {
  reversible: 'Réversible',
  irreversible: 'Irréversible',
};

export const ORIGIN_LABELS: Record<CardOrigin, string> = {
  framing: 'Cadrage',
  implementation: 'Implémentation',
};

const SKILL_LABELS: Readonly<Record<string, string>> = {
  framing: 'Cadrage',
  implementation: 'Implémentation',
  orchestrator: 'Orchestrateur',
};

/** `implementation@0.1.0` → « Implémentation 0.1.0 » ; un nom inconnu reste tel quel. */
export function formatSkill(skill: string): string {
  const [name = '', version] = skill.split('@');
  const label = SKILL_LABELS[name] ?? name;
  return version === undefined ? label : `${label} ${version}`;
}

/** Âge relatif en français : « à l'instant », « il y a 12 min », « il y a 3 h », « il y a 2 j ». */
export function formatAge(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${String(hours)} h`;
  return `il y a ${String(Math.floor(hours / 24))} j`;
}
