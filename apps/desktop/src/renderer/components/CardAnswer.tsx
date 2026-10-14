import type { AnswerChoice } from '@factory/conventions';
import type { CardView } from '@factory/orchestrator';
import { useId, useState } from 'react';
import type { Commands } from '../../shared/api';
import { LABELS, SHOULD_HAVE_BLOCKED_TEXT } from '../labels';

type AnswerCommands = Pick<Commands, 'answerCard' | 'validateItem' | 'markEvidenceReviewed'>;

/** Ce que l'humain a saisi au moment d'envoyer. */
export interface AnswerInput {
  note: string;
  shouldHaveBlocked: boolean;
}

export interface AnswerButton {
  label: string;
  /** « Autre », « Rejeter », « À discuter », « Bloqué » : désactivé tant que la note est vide. */
  requiresNote: boolean;
  send(commands: AnswerCommands, input: AnswerInput): Promise<void>;
}

function answer(card: CardView, choice: AnswerChoice, text: string) {
  return (commands: AnswerCommands) =>
    commands.answerCard(card.id, { cardId: card.id, choice, text });
}

function optional(note: string): string | undefined {
  return note === '' ? undefined : note;
}

/**
 * Boutons de réponse d'une carte, dans l'ordre affiché, et la commande de chacun (H3). Aucune
 * nouvelle commande : tout passe par `answerCard`, `validateItem` ou `markEvidenceReviewed`.
 */
export function answerButtons(card: CardView): AnswerButton[] {
  switch (card.kind) {
    case 'question':
    case 'arbitration':
      return [
        ...card.options.map((o) => ({
          label: o.text,
          requiresNote: false,
          send: (c: AnswerCommands, { note }: AnswerInput) =>
            answer(card, { kind: 'option', letter: o.letter }, note)(c),
        })),
        {
          label: LABELS.other,
          requiresNote: true,
          send: (c, { note }) => answer(card, { kind: 'other' }, note)(c),
        },
      ];
    case 'decision':
      return [
        {
          label: LABELS.keep,
          requiresNote: false,
          send: (c, { note }) => answer(card, { kind: 'keep' }, note)(c),
        },
        {
          label: LABELS.reverse,
          requiresNote: false,
          send: (c, { note, shouldHaveBlocked }) =>
            answer(
              card,
              { kind: 'reverse' },
              shouldHaveBlocked ? `${SHOULD_HAVE_BLOCKED_TEXT} ${note}`.trim() : note,
            )(c),
        },
      ];
    case 'action':
      return [
        {
          label: LABELS.done,
          requiresNote: false,
          send: (c, { note }) => answer(card, { kind: 'done' }, note)(c),
        },
      ];
    case 'item': {
      const item = card.item;
      if (!item) return [];
      const status = (s: 'validated' | 'rejected' | 'discussing', requiresNote: boolean) => ({
        requiresNote,
        send: (c: AnswerCommands, { note }: AnswerInput) =>
          c.validateItem(card.issue, item.id, s, optional(note)),
      });
      return [
        { label: LABELS.validate, ...status('validated', false) },
        { label: LABELS.reject, ...status('rejected', true) },
        { label: LABELS.discuss, ...status('discussing', true) },
      ];
    }
    case 'evidence': {
      const evidence = card.evidence;
      if (!evidence) return [];
      const verdict = (v: 'proven' | 'blocked', requiresNote: boolean) => ({
        requiresNote,
        send: (c: AnswerCommands, { note }: AnswerInput) =>
          c.markEvidenceReviewed(evidence.pr, evidence.criterion, v, optional(note)),
      });
      return [
        { label: LABELS.proven, ...verdict('proven', false) },
        { label: LABELS.blocked, ...verdict('blocked', true) },
      ];
    }
  }
}

/** Lettre affichée et raccourci du bouton de rang `index` : A, B, C… */
export function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

export interface CardAnswerProps {
  card: CardView;
  commands: AnswerCommands;
}

/** Zone de réponse d'une carte dépliée (SPEC-inbox, « Carte dépliée »). */
export function CardAnswer({ card, commands }: CardAnswerProps) {
  const [note, setNote] = useState('');
  const [shouldHaveBlocked, setShouldHaveBlocked] = useState(false);
  const noteId = useId();
  const buttons = answerButtons(card);
  const trimmed = note.trim();

  function submit(button: AnswerButton): void {
    void button.send(commands, { note: trimmed, shouldHaveBlocked });
  }

  return (
    <div
      role="group"
      aria-label={LABELS.answer}
      className="flex flex-col gap-2 border-t border-neutral-100 p-3"
    >
      <label htmlFor={noteId} className="text-xs text-neutral-500">
        {LABELS.note}
      </label>
      <textarea
        id={noteId}
        rows={2}
        value={note}
        className="rounded border border-neutral-300 p-2 text-sm"
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />
      {card.kind === 'decision' && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={shouldHaveBlocked}
            onChange={(e) => {
              setShouldHaveBlocked(e.target.checked);
            }}
          />
          {LABELS.shouldHaveBlocked}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b, i) => (
          <button
            key={letterOf(i)}
            type="button"
            aria-keyshortcuts={letterOf(i)}
            disabled={b.requiresNote && trimmed === ''}
            className="flex items-center gap-2 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
            onClick={() => {
              submit(b);
            }}
          >
            <kbd aria-hidden className="rounded bg-neutral-100 px-1 font-mono text-xs">
              {letterOf(i)}
            </kbd>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
