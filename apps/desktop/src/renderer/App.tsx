import type { InboxState } from '@factory/orchestrator';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import type { Api } from '../shared/api';
import { BlockedScreen } from './components/BlockedScreen';
import { Column } from './components/Column';
import { LABELS } from './labels';

/**
 * L'interface est une fonction pure de l'`InboxState` reçu par IPC (SPEC-inbox) : écran `blocked`,
 * sinon les trois files Arbitrer, Valider, Agir telles que l'orchestrateur les publie (H1).
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
    <main className="flex min-h-screen items-start gap-4 bg-neutral-50 p-4">
      <Column queue="arbitrate" cards={state.arbitrate} api={api} />
      <Column queue="validate" cards={state.validate} api={api} />
      <Column queue="act" cards={state.act} api={api} />
      <Toaster position="bottom-right" />
    </main>
  );
}
