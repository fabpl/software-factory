import type { CardView, InboxState } from '@factory/orchestrator';
import type { Runtime } from './runtime';

/**
 * Notifications de transition (SPEC-inbox, H2–H6) : fonction pure de deux `InboxState`
 * successifs. Une carte n'est nouvelle que si son id manque à l'état précédent ET si elle a été
 * créée après le démarrage du notificateur (H3) : ni rafale au lancement, ni après `retry()`.
 */

export interface Notice {
  title: string;
  /** « #<issue> <titre d'issue> ». */
  body: string;
  /** Carte à déplier au clic (H7) ; absente : la fenêtre s'ouvre sans focus. */
  cardId?: string;
}

export const NOTICE_TITLES = {
  runFinished: 'Run terminé',
  runFailed: 'Run échoué',
  verdict: 'En verdict',
} as const;

export function notificationsFor(before: InboxState, after: InboxState, startedAt: Date): Notice[] {
  const known = new Set([...before.arbitrate, ...before.validate, ...before.act].map((c) => c.id));
  const isNew = (c: CardView): boolean =>
    !known.has(c.id) && c.createdAt !== undefined && Date.parse(c.createdAt) > startedAt.getTime();
  const blocking = [...after.arbitrate, ...after.act].filter(isNew);
  const issueLabel = (issue: number, state: InboxState): string => {
    const title = state.tasks.find((t) => t.issue === issue)?.title;
    return title === undefined ? `#${String(issue)}` : `#${String(issue)} ${title}`;
  };

  const notices: Notice[] = [];
  const ended = before.run;
  if (ended !== undefined && after.run?.issue !== ended.issue) {
    const body = issueLabel(ended.issue, before);
    const type = ended.lastEvent.type;
    if (type === 'run.finished') {
      notices.push({ title: NOTICE_TITLES.runFinished, body });
    } else if (type !== 'run.waiting') {
      // H4 : la carte Agir née de l'échec est absorbée par la notification « Run échoué ».
      const index = blocking.findIndex((c) => c.kind === 'action' && c.issue === ended.issue);
      const [merged] = index === -1 ? [] : blocking.splice(index, 1);
      notices.push({
        title: NOTICE_TITLES.runFailed,
        body,
        ...(merged !== undefined ? { cardId: merged.id } : {}),
      });
    }
  }

  for (const c of blocking) {
    notices.push({ title: c.title, body: `#${String(c.issue)} ${c.issueTitle}`, cardId: c.id });
  }

  for (const t of after.tasks) {
    const previous = before.tasks.find((p) => p.issue === t.issue);
    if (previous === undefined || previous.phase === 'verdict' || t.phase !== 'verdict') continue;
    const proof = after.validate.find((c) => c.kind === 'evidence' && c.issue === t.issue);
    notices.push({
      title: NOTICE_TITLES.verdict,
      body: issueLabel(t.issue, after),
      ...(proof !== undefined ? { cardId: proof.id } : {}),
    });
  }
  return notices;
}

export interface NotifierOptions {
  /** Abonnement par le runtime (H2) : il survit à `retry()`. */
  runtime: Pick<Runtime, 'subscribe'>;
  /** Heure de démarrage, injectée pour les tests (H3). */
  startedAt: Date;
  /** Affiche une notification (`NotificationPort`). */
  show: (notice: Notice) => void;
}

/** Compare chaque état publié au précédent et affiche les notifications qui en découlent. */
export function startNotifier({ runtime, startedAt, show }: NotifierOptions): () => void {
  let previous: InboxState | undefined;
  return runtime.subscribe((state) => {
    if (previous !== undefined) {
      for (const notice of notificationsFor(previous, state, startedAt)) show(notice);
    }
    previous = state;
  });
}
