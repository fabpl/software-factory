import type { CardView } from '@factory/orchestrator';
import type { Api } from '../../shared/api';
import { LABELS, QUEUE_LABELS, type QueueName } from '../labels';
import { Card } from './Card';

export interface ColumnProps {
  queue: QueueName;
  cards: readonly CardView[];
  api: Pick<Api, 'commands'>;
}

/** Une file de l'inbox, dans l'ordre exact reçu de l'orchestrateur : aucun tri ici (H1). */
export function Column({ queue, cards, api }: ColumnProps) {
  const headingId = `column-${queue}`;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col gap-3">
      <h2
        id={headingId}
        className="flex items-center gap-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase"
      >
        {QUEUE_LABELS[queue]}
        <span className="rounded-full bg-neutral-200 px-2 text-neutral-700">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <p className="text-sm text-neutral-400">{LABELS.empty}</p>
      ) : (
        cards.map((card) => <Card key={card.id} card={card} api={api} />)
      )}
    </section>
  );
}
