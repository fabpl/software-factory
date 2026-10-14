import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { InboxState } from '@factory/orchestrator';
import {
  channel,
  ORCHESTRATOR_COMMANDS,
  STATE_CHANNEL,
  type Api,
  type Commands,
} from '../shared/api';

/** `window.api` (H4) : une fonction par commande, `getState`, `subscribe`. Rien d'autre ne passe. */
const commands = Object.fromEntries(
  [...ORCHESTRATOR_COMMANDS, 'retry'].map((name) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke(channel(name), ...args),
  ]),
) as unknown as Commands;

const api: Api = {
  getState: () => ipcRenderer.invoke(channel('getState')) as Promise<InboxState>,
  subscribe(listener) {
    const handler = (_event: IpcRendererEvent, state: InboxState): void => {
      listener(state);
    };
    ipcRenderer.on(STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(STATE_CHANNEL, handler);
    };
  },
  commands,
};

contextBridge.exposeInMainWorld('api', api);
