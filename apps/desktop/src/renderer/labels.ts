import type {
  CardOrigin,
  ItemStatus,
  Need,
  Phase,
  Reversibility,
  StartBlocker,
} from '@factory/conventions';
import type { CardView, RunView, TaskView } from '@factory/orchestrator';

type TaskPrView = NonNullable<TaskView['pr']>;

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
  sidebar: 'Tâches',
  refresh: 'Rafraîchir',
  startFraming: 'Lancer le cadrage',
  startImplementation: 'Lancer l’implémentation',
  sendBackToFraming: 'Renvoyer en cadrage',
  reason: 'Motif',
  lockActive: 'Run en cours',
  lockFailed: 'Run interrompu',
  pr: (n: number) => `PR #${String(n)}`,
  prDraft: 'brouillon',
  prReady: 'prête',
  prMerged: 'fusionnée',
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

export const PHASE_LABELS: Record<Phase, string> = {
  intent: 'Intention',
  framing: 'Cadrage',
  implementation: 'Implémentation',
  evidence: 'Preuves',
  verdict: 'Verdict',
};

export const NEED_LABELS: Record<Need, string> = {
  validation: 'À valider',
  arbitration: 'À arbitrer',
  action: 'À faire',
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: 'à valider',
  validated: 'validé',
  rejected: 'rejeté',
  discussing: 'à discuter',
};

export const CI_LABELS: Record<TaskPrView['ci']['kind'], string> = {
  none: 'Pas de CI',
  pending: 'CI en cours',
  green: 'CI verte',
  red: 'CI rouge',
};

export const EVENT_LABELS: Record<RunView['lastEvent']['type'], string> = {
  'run.started': 'Run démarré',
  'agent.message': 'Message de l’agent',
  'agent.tool': 'Outil utilisé',
  'card.emitted': 'Carte publiée',
  'contract.updated': 'Contrat mis à jour',
  'evidence.updated': 'Preuves mises à jour',
  'adr.requested': 'ADR demandé',
  'run.waiting': 'En attente d’une réponse',
  'run.finished': 'Run terminé',
  'run.failed': 'Run en échec',
};

/** Raison pour laquelle « Lancer l'implémentation » est grisé. */
export function formatStartBlocker(blocker: StartBlocker): string {
  return blocker.kind === 'item-not-settled'
    ? `${blocker.id} ${ITEM_STATUS_LABELS[blocker.status]}`
    : 'Aucun critère validé';
}

/** Durée écoulée : « moins d'une minute », « 20 min », « 2 h 05 min ». */
export function formatDuration(startedAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(startedAt)) / 60_000);
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, '0')} min`;
}

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
