import type { InboxState } from '@factory/orchestrator';
import { channel, ORCHESTRATOR_COMMANDS, type OrchestratorCommands } from '../shared/api';
import type { Runtime } from './runtime';

/** Sous-ensemble d'`ipcMain` utilisé ici, pour tester sans Electron. */
export interface IpcMainPort {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface IpcOptions {
  ipcMain: IpcMainPort;
  runtime: Runtime;
  /** Pousse un `InboxState` au renderer (`webContents.send`). */
  send: (state: InboxState) => void;
}

type AnyCommand = (...args: unknown[]) => Promise<void>;

/**
 * Un handler par commande publique de l'`Orchestrator` (H4, C2), mêmes arguments, toujours sur
 * l'orchestrateur courant (il change après `retry`). `subscribe` relaie chaque état au renderer.
 */
export function registerIpc({ ipcMain, runtime, send }: IpcOptions): void {
  for (const name of ORCHESTRATOR_COMMANDS) {
    ipcMain.handle(channel(name), (_event, ...args) => {
      const orchestrator: OrchestratorCommands = runtime.current();
      return (orchestrator[name] as AnyCommand)(...args);
    });
  }
  ipcMain.handle(channel('retry'), () => runtime.retry());
  ipcMain.handle(channel('getState'), () => runtime.getState());
  runtime.subscribe(send);
}
