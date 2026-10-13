import { err, ok, type Result } from './result.js';

export const PHASES = ['intent', 'framing', 'implementation', 'evidence', 'verdict'] as const;
export type Phase = (typeof PHASES)[number];

export const NEEDS = ['validation', 'arbitration', 'action'] as const;
export type Need = (typeof NEEDS)[number];

export const RUN_STATES = ['active', 'failed'] as const;
export type RunState = (typeof RUN_STATES)[number];

export type Actor = 'human' | 'orchestrator';

export const PHASE_LABEL_PREFIX = 'phase:';
export const NEEDS_LABEL_PREFIX = 'needs:';
export const RUN_LABEL_PREFIX = 'run:';

export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

/** Toutes les étiquettes que l'app crée sur un dépôt au premier lancement. */
export const LABEL_DEFINITIONS: readonly LabelDefinition[] = [
  { name: 'phase:intent', color: 'c5def5', description: 'Intention déclarée, cadrage pas lancé' },
  {
    name: 'phase:framing',
    color: '1d76db',
    description: 'Cadrage en cours : contrat en construction',
  },
  { name: 'phase:implementation', color: '0e8a16', description: 'Implémentation par l’agent' },
  { name: 'phase:evidence', color: 'fbca04', description: 'Preuves à examiner' },
  {
    name: 'phase:verdict',
    color: '5319e7',
    description: 'Verdict : fusionner ou renvoyer en cadrage',
  },
  {
    name: 'needs:validation',
    color: 'bfd4f2',
    description: 'L’agent a tranché, confirmation attendue',
  },
  { name: 'needs:arbitration', color: 'd93f0b', description: 'L’agent attend un choix' },
  { name: 'needs:action', color: 'e99695', description: 'Action humaine hors app requise' },
  { name: 'run:active', color: '006b75', description: 'Run en cours (verrou)' },
  {
    name: 'run:failed',
    color: 'b60205',
    description: 'Run arrêté sans carte ni changement de phase',
  },
];

interface Transition {
  from: Phase;
  to: Phase;
  actors: readonly Actor[];
}

/** Diagramme de SPEC-conventions §1. */
const TRANSITIONS: readonly Transition[] = [
  { from: 'intent', to: 'framing', actors: ['human'] },
  { from: 'framing', to: 'implementation', actors: ['human'] },
  { from: 'implementation', to: 'evidence', actors: ['orchestrator'] },
  { from: 'evidence', to: 'verdict', actors: ['orchestrator'] },
  { from: 'implementation', to: 'framing', actors: ['human'] },
  { from: 'evidence', to: 'framing', actors: ['human'] },
  { from: 'verdict', to: 'framing', actors: ['human'] },
];

export function canTransition(from: Phase, to: Phase, actor: Actor): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actors.includes(actor));
}

export function nextPhases(from: Phase, actor: Actor): Phase[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.to);
}

export interface TaskLabels {
  /** Absente = l'issue n'est pas gérée par l'app. */
  phase?: Phase;
  needs: ReadonlySet<Need>;
  run?: RunState;
  /** Étiquettes qui ne sont pas à nous : conservées, jamais touchées. */
  others: readonly string[];
}

export type LabelsError =
  { kind: 'multiple-phases'; phases: Phase[] } | { kind: 'multiple-runs'; runs: RunState[] };

function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

function isNeed(value: string): value is Need {
  return (NEEDS as readonly string[]).includes(value);
}

function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

/**
 * Lit les étiquettes d'une issue. Une étiquette `phase:` ou `run:` inconnue
 * (par exemple `phase:foo`) est traitée comme étrangère et conservée dans `others`.
 */
export function parseLabels(labels: readonly string[]): Result<TaskLabels, LabelsError> {
  const phases: Phase[] = [];
  const needs = new Set<Need>();
  const runs: RunState[] = [];
  const others: string[] = [];

  for (const label of labels) {
    if (label.startsWith(PHASE_LABEL_PREFIX) && isPhase(label.slice(PHASE_LABEL_PREFIX.length))) {
      phases.push(label.slice(PHASE_LABEL_PREFIX.length) as Phase);
    } else if (
      label.startsWith(NEEDS_LABEL_PREFIX) &&
      isNeed(label.slice(NEEDS_LABEL_PREFIX.length))
    ) {
      needs.add(label.slice(NEEDS_LABEL_PREFIX.length) as Need);
    } else if (
      label.startsWith(RUN_LABEL_PREFIX) &&
      isRunState(label.slice(RUN_LABEL_PREFIX.length))
    ) {
      runs.push(label.slice(RUN_LABEL_PREFIX.length) as RunState);
    } else {
      others.push(label);
    }
  }

  if (phases.length > 1) return err({ kind: 'multiple-phases', phases });
  if (runs.length > 1) return err({ kind: 'multiple-runs', runs });

  const result: TaskLabels = { needs, others };
  if (phases[0] !== undefined) result.phase = phases[0];
  if (runs[0] !== undefined) result.run = runs[0];
  return ok(result);
}

/** Étiquettes complètes à poser sur l'issue, étrangères comprises, dans un ordre stable. */
export function labelsFor(task: TaskLabels): string[] {
  const out: string[] = [];
  if (task.phase !== undefined) out.push(PHASE_LABEL_PREFIX + task.phase);
  for (const need of NEEDS) if (task.needs.has(need)) out.push(NEEDS_LABEL_PREFIX + need);
  if (task.run !== undefined) out.push(RUN_LABEL_PREFIX + task.run);
  out.push(...[...task.others].sort());
  return out;
}
