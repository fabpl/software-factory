import type { InboxState } from '@factory/orchestrator';
import {
  channel,
  FOCUS_CHANNEL,
  ORCHESTRATOR_COMMANDS,
  STATE_CHANNEL,
  type Api,
  type Commands,
} from '../shared/api';

type Listener = (event: unknown, ...args: unknown[]) => void;

/** Sous-ensemble d'`ipcRenderer` utilisé ici, pour tester sans Electron. */
export interface IpcRendererPort {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): void;
  removeListener(channel: string, listener: Listener): void;
}

/** `window.api` (H4) : une fonction par commande, `getState`, `subscribe`, `onFocus` (H7). */
export function createApi(ipcRenderer: IpcRendererPort): Api {
  const commands = Object.fromEntries(
    [...ORCHESTRATOR_COMMANDS, 'retry'].map((name) => [
      name,
      (...args: unknown[]) => ipcRenderer.invoke(channel(name), ...args),
    ]),
  ) as unknown as Commands;

  function listen(name: string, listener: (value: unknown) => void): () => void {
    const handler: Listener = (_event, value) => {
      listener(value);
    };
    ipcRenderer.on(name, handler);
    return () => {
      ipcRenderer.removeListener(name, handler);
    };
  }

  return {
    getState: () => ipcRenderer.invoke(channel('getState')) as Promise<InboxState>,
    subscribe: (listener) =>
      listen(STATE_CHANNEL, (state) => {
        listener(state as InboxState);
      }),
    onFocus: (listener) =>
      listen(FOCUS_CHANNEL, (cardId) => {
        listener(cardId as string);
      }),
    commands,
  };
}
