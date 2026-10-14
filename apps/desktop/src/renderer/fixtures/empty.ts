import type { InboxState } from '@factory/orchestrator';

/** Orchestrateur prêt, aucune tâche : trois colonnes « Rien à faire ici ». */
export const EMPTY: InboxState = {
  status: 'ready',
  repo: { slug: 'acme/widget', path: '/Users/moi/.software-factory/repos/acme-widget' },
  validate: [],
  arbitrate: [],
  act: [],
  tasks: [],
  lastSync: new Date('2026-10-14T10:00:00Z'),
  errors: [],
};
