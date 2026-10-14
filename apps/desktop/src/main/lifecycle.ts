/**
 * Cycle de vie (H9) : fermer la fenêtre la masque ; « Quitter » (barre de menus, ⌘Q,
 * `before-quit`) passe par une seule fonction qui arrête l'orchestrateur (annule le run, ≤ 10 s)
 * puis quitte, même si l'arrêt échoue.
 */

/** Sous-ensemble d'`app` utilisé ici (`AppPort`). */
export interface AppPort {
  quit(): void;
}

export interface LifecyclePorts {
  /** `runtime.stop()`. */
  stop: () => Promise<void>;
  app: AppPort;
}

interface Preventable {
  preventDefault(): void;
}

export interface Lifecycle {
  /** Vrai dès que « Quitter » est demandé : la fenêtre peut alors se fermer. */
  quitting(): boolean;
  quit(): Promise<void>;
  /** Gestionnaire `close` de la fenêtre. */
  onClose(event: Preventable, window: { hide(): void }): void;
  /** Gestionnaire `before-quit` de l'app. */
  onBeforeQuit(event: Preventable): void;
}

export function createLifecycle({ stop, app }: LifecyclePorts): Lifecycle {
  let stopping: Promise<void> | undefined;
  let stopped = false;

  function quit(): Promise<void> {
    stopping ??= stop()
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        stopped = true;
        app.quit();
      });
    return stopping;
  }

  return {
    quitting: () => stopping !== undefined,
    quit,
    onClose(event, window) {
      if (stopping !== undefined) return;
      event.preventDefault();
      window.hide();
    },
    onBeforeQuit(event) {
      if (stopped) return;
      event.preventDefault();
      void quit();
    },
  };
}
