import type { InboxState } from '@factory/orchestrator';

/** `gh` déconnecté : ce que `bootstrap()` renvoie via `Orchestrator.blocked(...)`. */
export const BLOCKED: InboxState = {
  status: 'blocked',
  blockedReason: {
    message: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
    command: 'gh auth login',
  },
  validate: [],
  arbitrate: [],
  act: [],
  tasks: [],
  lastSync: new Date('2026-10-14T10:00:00Z'),
  errors: [],
};
