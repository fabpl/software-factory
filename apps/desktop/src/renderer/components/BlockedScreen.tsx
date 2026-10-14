import { useState } from 'react';
import type { Api } from '../../shared/api';
import { LABELS } from '../labels';

export interface BlockedScreenProps {
  reason: { message: string; command?: string };
  api: Pick<Api, 'commands'>;
}

/**
 * État `blocked` (SPEC-inbox) : prérequis manquant, commande à copier, « Réessayer » qui rappelle
 * `bootstrap()` dans le process principal (H8).
 */
export function BlockedScreen({ reason, api }: BlockedScreenProps) {
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function copy(command: string): Promise<void> {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  async function retry(): Promise<void> {
    setRetrying(true);
    setError(undefined);
    try {
      await api.commands.retry();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  const command = reason.command;
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <article className="w-full max-w-xl rounded-lg border border-amber-300 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">{LABELS.blockedTitle}</h1>
        <p className="mt-2 text-sm text-neutral-700">{reason.message}</p>
        {command !== undefined && (
          <>
            <p className="mt-4 text-sm text-neutral-600">{LABELS.blockedHint}</p>
            <div className="mt-2 flex items-center gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-50">
                <code role="code">{command}</code>
              </pre>
              <button
                type="button"
                className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
                onClick={() => void copy(command)}
              >
                {copied ? LABELS.copied : LABELS.copy}
              </button>
            </div>
          </>
        )}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? LABELS.retrying : LABELS.retry}
          </button>
          {error !== undefined && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </article>
    </main>
  );
}
