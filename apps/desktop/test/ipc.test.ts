import type { InboxState } from '@factory/orchestrator';
import { describe, expect, it, vi } from 'vitest';
import { registerIpc } from '../src/main/ipc';
import { createRuntime } from '../src/main/runtime';
import { createApi, type IpcRendererPort } from '../src/preload/api';
import {
  channel,
  FOCUS_CHANNEL,
  ORCHESTRATOR_COMMANDS,
  STATE_CHANNEL,
  type OrchestratorCommands,
} from '../src/shared/api';
import { fakeIpcMain, fakeOrchestrator, inboxState } from './fakes';

async function setup() {
  const orchestrator = fakeOrchestrator();
  const runtime = await createRuntime({
    bootstrap: () => Promise.resolve(orchestrator),
    home: '/tmp/maison',
  });
  const ipcMain = fakeIpcMain();
  const send = vi.fn<(state: InboxState) => void>();
  registerIpc({ ipcMain, runtime, send });
  const invoke = (name: string, ...args: unknown[]): unknown => {
    const handler = ipcMain.handlers.get(channel(name));
    if (!handler) throw new Error(`aucun handler pour ${name}`);
    return handler({}, ...args);
  };
  return { orchestrator, runtime, ipcMain, send, invoke };
}

describe('registerIpc (H4, C2)', () => {
  it('enregistre un handler par commande publique, plus getState et retry', async () => {
    const { ipcMain } = await setup();
    const expected = [...ORCHESTRATOR_COMMANDS, 'retry', 'getState'].map(channel).sort();
    expect([...ipcMain.handlers.keys()].sort()).toEqual(expected);
    expect(ORCHESTRATOR_COMMANDS).toContain('createIntent');
    expect(ORCHESTRATOR_COMMANDS).toContain('cancelRun');
  });

  const answer = { cardId: 'card-1', choice: { kind: 'option' as const, letter: 'A' }, text: '' };
  const cases: [string, unknown[]][] = [
    ['startFraming', [7]],
    ['startImplementation', [7]],
    ['sendBackToFraming', [7, 'contrat caduc']],
    ['answerCard', ['card-1', answer]],
    ['validateItem', [7, 'H1', 'validated', 'ok']],
    ['validateItem', [7, 'H1', 'rejected']],
    ['markActionDone', ['card-2']],
    ['markEvidenceReviewed', [20, 'C1', 'proven', 'vu']],
    ['markEvidenceReviewed', [20, 'C1', 'blocked']],
    ['refresh', []],
    ['createIntent', ['Nouvelle idée', 'Texte libre']],
    ['cancelRun', []],
  ];
  it.each(cases)('%s relaie les mêmes arguments à l’orchestrateur', async (name, args) => {
    const { orchestrator, invoke } = await setup();
    await invoke(name, ...args);
    const method = orchestrator[name as keyof OrchestratorCommands];
    expect(method).toHaveBeenCalledTimes(1);
    expect(method.mock.calls[0]).toEqual(args);
  });

  it('getState renvoie l’état courant de l’orchestrateur', async () => {
    const { invoke, orchestrator } = await setup();
    expect(await invoke('getState')).toBe(orchestrator.getState());
  });

  it('subscribe relaie chaque InboxState au renderer', async () => {
    const { orchestrator, send } = await setup();
    expect(send).toHaveBeenCalledTimes(1);
    const next = inboxState({ errors: ['#7 ignorée : labels'] });
    orchestrator.publish(next);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(next);
  });
});

describe('preload : window.api (H4, H7, C5)', () => {
  function fakeIpcRenderer() {
    const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
    return {
      listeners,
      emit(name: string, ...args: unknown[]) {
        for (const l of listeners.get(name) ?? []) l({}, ...args);
      },
      invoke: vi.fn<IpcRendererPort['invoke']>(() => Promise.resolve(undefined)),
      on(name: string, listener: (event: unknown, ...args: unknown[]) => void) {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
      },
      removeListener(name: string, listener: (event: unknown, ...args: unknown[]) => void) {
        listeners.get(name)?.delete(listener);
      },
    };
  }

  it('onFocus relaie chaque identifiant reçu sur factory:focus, jusqu’au désabonnement', () => {
    const ipc = fakeIpcRenderer();
    const api = createApi(ipc);
    const listener = vi.fn<(cardId: string) => void>();
    const unsubscribe = api.onFocus(listener);
    expect(FOCUS_CHANNEL).toBe('factory:focus');
    ipc.emit(FOCUS_CHANNEL, 'card-7');
    expect(listener).toHaveBeenCalledWith('card-7');
    unsubscribe();
    ipc.emit(FOCUS_CHANNEL, 'card-8');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe relaie chaque état reçu sur factory:state, jusqu’au désabonnement', () => {
    const ipc = fakeIpcRenderer();
    const api = createApi(ipc);
    const listener = vi.fn<(state: InboxState) => void>();
    const unsubscribe = api.subscribe(listener);
    const state = inboxState();
    ipc.emit(STATE_CHANNEL, state);
    expect(listener).toHaveBeenCalledWith(state);
    unsubscribe();
    ipc.emit(STATE_CHANNEL, state);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('getState et chaque commande passent par invoke sur leur canal', async () => {
    const ipc = fakeIpcRenderer();
    const api = createApi(ipc);
    await api.getState();
    await api.commands.startFraming(7);
    await api.commands.retry();
    expect(ipc.invoke.mock.calls).toEqual([
      [channel('getState')],
      [channel('startFraming'), 7],
      [channel('retry')],
    ]);
  });
});
