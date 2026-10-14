import type { InboxState } from '@factory/orchestrator';
import { useEffect, useState } from 'react';
import type { Api } from '../shared/api';
import { BlockedScreen } from './components/BlockedScreen';
import { LABELS } from './labels';

/**
 * L'interface est une fonction pure de l'`InboxState` reçu par IPC (SPEC-inbox). T21 : écran
 * `blocked` ou écran d'attente neutre ; les trois colonnes arrivent avec T22.
 */
export function App({ api }: { api: Api }) {
  const [state, setState] = useState<InboxState | undefined>();

  useEffect(() => {
    const unsubscribe = api.subscribe(setState);
    void api.getState().then(setState);
    return unsubscribe;
  }, [api]);

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        {LABELS.connecting}
      </main>
    );
  }
  if (state.status === 'blocked') {
    return (
      <BlockedScreen reason={state.blockedReason ?? { message: LABELS.blockedTitle }} api={api} />
    );
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-50 text-neutral-700">
      <h1 className="text-lg font-semibold text-neutral-900">{LABELS.readyTitle}</h1>
      <p className="text-sm">{LABELS.readyHint}</p>
      <p className="text-xs text-neutral-500">
        {LABELS.lastSync} : {state.lastSync.toLocaleTimeString('fr-FR')}
      </p>
    </main>
  );
}
