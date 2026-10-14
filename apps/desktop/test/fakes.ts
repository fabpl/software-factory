import type { InboxState } from '@factory/orchestrator';
import { vi, type Mock } from 'vitest';
import type { OrchestratorPort } from '../src/main/runtime';
import type { IpcMainPort } from '../src/main/ipc';
import type { Api, Commands, OrchestratorCommands } from '../src/shared/api';

export function inboxState(overrides: Partial<InboxState> = {}): InboxState {
  return {
    status: 'ready',
    validate: [],
    arbitrate: [],
    act: [],
    tasks: [],
    lastSync: new Date('2026-10-14T10:00:00Z'),
    errors: [],
    ...overrides,
  };
}

export const BLOCKED_STATE = inboxState({
  status: 'blocked',
  blockedReason: { message: 'You are not logged into any GitHub hosts.', command: 'gh auth login' },
});

/** Propriétés-fonctions (pas des méthodes) : les tests lisent `mock.calls` sans lier `this`. */
export type FakeOrchestrator = {
  [K in keyof OrchestratorCommands]: Mock<OrchestratorCommands[K]>;
} & {
  subscribe: Mock<OrchestratorPort['subscribe']>;
  getState: Mock<() => InboxState>;
  start: Mock<() => void>;
  stop: Mock<() => Promise<void>>;
  /** Publie un état à tous les abonnés, comme le ferait un tick. */
  publish(state: InboxState): void;
  listeners: Set<(state: InboxState) => void>;
};

/** Orchestrateur factice : chaque commande est un `vi.fn`, `subscribe` rappelle l'état courant. */
export function fakeOrchestrator(initial: InboxState = inboxState()): FakeOrchestrator {
  let state = initial;
  const listeners = new Set<(s: InboxState) => void>();
  return {
    listeners,
    publish(next) {
      state = next;
      for (const l of listeners) l(state);
    },
    subscribe: vi.fn((listener: (s: InboxState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    }),
    getState: vi.fn(() => state),
    start: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
    startFraming: vi.fn(() => Promise.resolve()),
    startImplementation: vi.fn(() => Promise.resolve()),
    sendBackToFraming: vi.fn(() => Promise.resolve()),
    answerCard: vi.fn(() => Promise.resolve()),
    validateItem: vi.fn(() => Promise.resolve()),
    markActionDone: vi.fn(() => Promise.resolve()),
    markEvidenceReviewed: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
  };
}

export interface FakeApi extends Api {
  publish(state: InboxState): void;
  listeners: Set<(state: InboxState) => void>;
  commands: { [K in keyof Commands]: ReturnType<typeof vi.fn<Commands[K]>> };
}

/** `window.api` factice pour le renderer : toutes les commandes sont des `vi.fn`. */
export function fakeApi(initial: InboxState = inboxState()): FakeApi {
  let state = initial;
  const listeners = new Set<(s: InboxState) => void>();
  return {
    listeners,
    publish(next) {
      state = next;
      for (const l of listeners) l(state);
    },
    getState: () => Promise.resolve(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commands: {
      startFraming: vi.fn(() => Promise.resolve()),
      startImplementation: vi.fn(() => Promise.resolve()),
      sendBackToFraming: vi.fn(() => Promise.resolve()),
      answerCard: vi.fn(() => Promise.resolve()),
      validateItem: vi.fn(() => Promise.resolve()),
      markActionDone: vi.fn(() => Promise.resolve()),
      markEvidenceReviewed: vi.fn(() => Promise.resolve()),
      refresh: vi.fn(() => Promise.resolve()),
      retry: vi.fn(() => Promise.resolve()),
    },
  };
}

export type Handler = (event: unknown, ...args: unknown[]) => unknown;

/** `ipcMain` factice : mémorise les handlers par canal. */
export function fakeIpcMain(): IpcMainPort & { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle(channel: string, listener: Handler) {
      handlers.set(channel, listener);
    },
  };
}
