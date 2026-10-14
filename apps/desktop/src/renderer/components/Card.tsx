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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api } from '../../shared/api';
import {
  KIND_LABELS,
  LABELS,
  ORIGIN_LABELS,
  REVERSIBILITY_LABELS,
  formatAge,
  formatSkill,
} from '../labels';
import { CardAnswer, type KeyHandler } from './CardAnswer';
import { Markdown } from './Markdown';

const KIND_ICONS: Record<CardView['kind'], LucideIcon> = {
  question: CircleHelp,
  arbitration: Pause,
  decision: SquarePen,
  action: Square,
  item: ListChecks,
  evidence: Search,
};

/** « Ouvrir sur la carte » (H7) : `seq` change à chaque clic de notification. */
export interface FocusRequest {
  cardId: string;
  seq: number;
}

export interface CardProps {
  card: CardView;
  api: Pick<Api, 'commands'>;
  focus?: FocusRequest | undefined;
}

/** Carte repliée : icône, type, titre, issue, réversibilité, âge ; un clic déplie (SPEC-inbox). */
export function Card({ card, api, focus }: CardProps) {
  const [open, setOpen] = useState(false);
  const answer = useRef<KeyHandler>(null);
  const element = useRef<HTMLElement>(null);
  const Icon = KIND_ICONS[card.kind];

  useEffect(() => {
    if (focus?.cardId !== card.id) return;
    setOpen(true);
    element.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, card.id]);

  return (
    <article
      ref={element}
      aria-expanded={open}
      aria-labelledby={`card-${card.id}-title`}
      className="rounded-lg border border-neutral-200 bg-white shadow-sm"
      onKeyDown={(e) => {
        answer.current?.onKeyDown(e);
      }}
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
      {open && <CardBody card={card} />}
      {open && <CardAnswer ref={answer} card={card} commands={api.commands} />}
    </article>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-800">{children}</dd>
    </>
  );
}

/** Contexte, options, méta-données et liens d'une carte dépliée. */
function CardBody({ card }: { card: CardView }) {
  const recommended = card.recommendation?.letter;
  return (
    <div className="flex flex-col gap-3 border-t border-neutral-100 p-3">
      {card.context !== '' && <Markdown>{card.context}</Markdown>}
      {card.options.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {card.options.map((o) => (
            <li
              key={o.letter}
              className={
                o.letter === recommended
                  ? 'rounded bg-emerald-50 p-2 ring-1 ring-emerald-300'
                  : 'p-2'
              }
            >
              <span className="font-mono font-semibold">{o.letter}.</span> {o.text}
              {o.consequence !== undefined && (
                <span className="block text-neutral-500">{o.consequence}</span>
              )}
              {o.letter === recommended && (
                <span className="mt-1 block text-xs font-medium text-emerald-800">
                  {LABELS.recommended}
                  {card.recommendation?.text !== '' && (
                    <span className="block font-normal">{card.recommendation?.text}</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {card.changeCost !== undefined && <Meta label={LABELS.changeCost}>{card.changeCost}</Meta>}
        {card.reversibility !== undefined && (
          <Meta label={LABELS.reversibility}>{REVERSIBILITY_LABELS[card.reversibility]}</Meta>
        )}
        {card.origin !== undefined && (
          <Meta label={LABELS.origin}>{ORIGIN_LABELS[card.origin]}</Meta>
        )}
        {card.skill !== undefined && <Meta label={LABELS.skill}>{formatSkill(card.skill)}</Meta>}
      </dl>
      <div className="flex gap-4 text-sm">
        {card.evidence?.artifactUrl !== undefined && (
          <a
            href={card.evidence.artifactUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            {LABELS.openArtifact}
          </a>
        )}
        {card.url !== undefined && (
          <a href={card.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
            {LABELS.openInGitHub}
          </a>
        )}
      </div>
    </div>
  );
}
