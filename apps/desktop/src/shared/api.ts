import type { CardAnswer, ItemStatus } from '@factory/conventions';
import type { InboxState } from '@factory/orchestrator';

/**
 * Contrat IPC partagé par le process principal, le preload et le renderer (H4). Une fonction par
 * commande publique de l'`Orchestrator`, mêmes noms et mêmes arguments, plus `retry` qui est
 * traitée par le process principal lui-même.
 */

export interface OrchestratorCommands {
  startFraming(issue: number): Promise<void>;
  startImplementation(issue: number): Promise<void>;
  sendBackToFraming(issue: number, reason: string): Promise<void>;
  answerCard(cardId: string, answer: CardAnswer): Promise<void>;
  validateItem(issue: number, itemId: string, status: ItemStatus, note?: string): Promise<void>;
  markActionDone(cardId: string): Promise<void>;
  markEvidenceReviewed(
    pr: number,
    criterion: string,
    verdict: 'proven' | 'blocked',
    note?: string,
  ): Promise<void>;
  refresh(): Promise<void>;
  createIntent(title: string, body: string): Promise<void>;
  cancelRun(): Promise<void>;
}

export const ORCHESTRATOR_COMMANDS = [
  'startFraming',
  'startImplementation',
  'sendBackToFraming',
  'answerCard',
  'validateItem',
  'markActionDone',
  'markEvidenceReviewed',
  'refresh',
  'createIntent',
  'cancelRun',
] as const satisfies readonly (keyof OrchestratorCommands)[];

export interface Commands extends OrchestratorCommands {
  /** Rappelle `bootstrap()` dans le process principal et remplace l'orchestrateur (H8). */
  retry(): Promise<void>;
}

export interface Api {
  getState(): Promise<InboxState>;
  subscribe(listener: (state: InboxState) => void): () => void;
  commands: Commands;
}

/** Canal `ipcRenderer.send` → renderer : chaque `InboxState` publié. */
export const STATE_CHANNEL = 'factory:state';

export function channel(name: string): string {
  return `factory:${name}`;
}

declare global {
  interface Window {
    api: Api;
  }
}
