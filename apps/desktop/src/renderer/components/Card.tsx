import type { CardView } from '@factory/orchestrator';
import {
  CircleHelp,
  ListChecks,
  Pause,
  Search,
  Square,
  SquarePen,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { Api } from '../../shared/api';
import { KIND_LABELS, LABELS, REVERSIBILITY_LABELS, formatAge } from '../labels';

const KIND_ICONS: Record<CardView['kind'], LucideIcon> = {
  question: CircleHelp,
  arbitration: Pause,
  decision: SquarePen,
  action: Square,
  item: ListChecks,
  evidence: Search,
};

export interface CardProps {
  card: CardView;
  api: Pick<Api, 'commands'>;
}

/** Carte repliée : icône, type, titre, issue, réversibilité, âge ; un clic déplie (SPEC-inbox). */
export function Card({ card }: CardProps) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICONS[card.kind];
  return (
    <article
      aria-expanded={open}
      aria-labelledby={`card-${card.id}-title`}
      className="rounded-lg border border-neutral-200 bg-white shadow-sm"
    >
      <button
        type="button"
        className="flex w-full flex-col gap-1 p-3 text-left hover:bg-neutral-50"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          <Icon aria-hidden className="size-4" />
          <span>{KIND_LABELS[card.kind]}</span>
          <span>{LABELS.issue(card.issue)}</span>
          {card.reversibility !== undefined && (
            <span
              className={
                card.reversibility === 'irreversible'
                  ? 'rounded bg-amber-100 px-1.5 text-amber-800'
                  : 'rounded bg-neutral-100 px-1.5'
              }
            >
              {REVERSIBILITY_LABELS[card.reversibility]}
            </span>
          )}
          {card.createdAt !== undefined && (
            <span className="ml-auto">{formatAge(card.createdAt, Date.now())}</span>
          )}
        </span>
        <h3 id={`card-${card.id}-title`} className="text-sm font-medium text-neutral-900">
          {card.title}
        </h3>
      </button>
    </article>
  );
}
