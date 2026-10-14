import type { InboxState } from '@factory/orchestrator';

/** Orchestrateur prêt, aucune tâche : l'écran d'attente de T21. */
export const EMPTY: InboxState = {
  status: 'ready',
  validate: [],
  arbitrate: [],
  act: [],
  tasks: [],
  lastSync: new Date('2026-10-14T10:00:00Z'),
  errors: [],
};
