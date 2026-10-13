import { parseMarker, renderMarker } from './block.js';
import { group } from './regex.js';
import { err, ok, type Result } from './result.js';

export const CARD_KINDS = ['question', 'arbitration', 'decision', 'action'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_ORIGINS = ['framing', 'implementation'] as const;
export type CardOrigin = (typeof CARD_ORIGINS)[number];

export const REVERSIBILITIES = ['reversible', 'irreversible'] as const;
export type Reversibility = (typeof REVERSIBILITIES)[number];

export const CARD_STATUSES = ['open', 'answered', 'kept', 'reversed', 'done', 'cancelled'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const QUEUES = ['validate', 'arbitrate', 'act'] as const;
export type Queue = (typeof QUEUES)[number];

export interface CardOption {
  letter: string;
  text: string;
  consequence?: string;
}

/** Ce que l'agent fournit à `emit_card` ; l'orchestrateur ajoute id, origin, status, skill. */
export interface CardInput {
  kind: CardKind;
  title: string;
  context: string;
  options: CardOption[];
  recommendation?: { letter: string; text: string };
  changeCost?: string;
  reversibility: Reversibility;
}

export interface Card extends CardInput {
  id: string;
  origin: CardOrigin;
  status: CardStatus;
  skill: string;
}

export type CardError =
  | { kind: 'missing-marker' }
  | { kind: 'bad-attr'; attr: string; value: string }
  | { kind: 'missing-title' }
  | { kind: 'too-few-options'; count: number }
  | { kind: 'decision-not-reversible' }
  | { kind: 'bad-option-line'; line: string };

export const CARD_MARKER = 'card';
export const ANSWER_MARKER = 'answer';

const HEADINGS: Record<CardKind, { icon: string; word: string }> = {
  question: { icon: '❓', word: 'Question' },
  arbitration: { icon: '⏸', word: 'Arbitrage' },
  decision: { icon: '✎', word: 'Décision' },
  action: { icon: '☐', word: 'Action' },
};

function oneOf<T extends string>(values: readonly T[], v: string | undefined): v is T {
  return v !== undefined && (values as readonly string[]).includes(v);
}

/** `card-7` → 7 ; sinon 0. */
export function cardNumber(id: string): number {
  const m = /^card-(\d+)$/.exec(id);
  return m ? Number(group(m, 1)) : 0;
}

export function isBlocking(kind: CardKind): boolean {
  return kind === 'question' || kind === 'arbitration' || kind === 'action';
}

export function queueFor(kind: CardKind): Queue {
  if (kind === 'decision') return 'validate';
  if (kind === 'action') return 'act';
  return 'arbitrate';
}

export function validateCardInput(input: CardInput): Result<true, CardError> {
  if (input.title.trim() === '') return err({ kind: 'missing-title' });
  if (input.kind !== 'action' && input.options.length < 2) {
    return err({ kind: 'too-few-options', count: input.options.length });
  }
  if (input.kind === 'decision' && input.reversibility !== 'reversible') {
    return err({ kind: 'decision-not-reversible' });
  }
  return ok(true);
}

const SECTION_RE =
  /^\*\*(Contexte|Options|Recommandation|Coût d'un changement d'avis)\*\*(?: — (.*))?$/;
const OPTION_RE = /^- \*\*([A-Z])\.\*\* (.+)$/;
const CONSEQUENCE_RE = /^ {2}Conséquence : (.+)$/;
const HEADING_RE = /^### .*? — (.+)$/;

/** Lit un commentaire de carte : marqueur caché puis rendu Markdown. */
export function parseCard(comment: string): Result<Card, CardError> {
  const marker = parseMarker(comment);
  if (marker?.name !== CARD_MARKER) return err({ kind: 'missing-marker' });
  const a = marker.attrs;

  const id = a.id;
  if (id === undefined || !/^card-\d+$/.test(id))
    return err({ kind: 'bad-attr', attr: 'id', value: id ?? '' });
  if (!oneOf(CARD_KINDS, a.kind))
    return err({ kind: 'bad-attr', attr: 'kind', value: a.kind ?? '' });
  if (!oneOf(CARD_ORIGINS, a.origin))
    return err({ kind: 'bad-attr', attr: 'origin', value: a.origin ?? '' });
  if (!oneOf(REVERSIBILITIES, a.reversibility)) {
    return err({ kind: 'bad-attr', attr: 'reversibility', value: a.reversibility ?? '' });
  }
  if (!oneOf(CARD_STATUSES, a.status))
    return err({ kind: 'bad-attr', attr: 'status', value: a.status ?? '' });
  const skill = a.skill;
  if (skill === undefined || !/^[a-z-]+@\d+\.\d+\.\d+$/.test(skill)) {
    return err({ kind: 'bad-attr', attr: 'skill', value: skill ?? '' });
  }

  let title = '';
  let section: 'context' | 'options' | 'recommendation' | 'cost' | undefined;
  const context: string[] = [];
  const options: CardOption[] = [];
  let recommendation: { letter: string; text: string } | undefined;
  let changeCost: string | undefined;

  const lines = comment.split('\n').slice(1);
  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    if (h && title === '') {
      title = group(h, 1).trim();
      continue;
    }
    const s = SECTION_RE.exec(line);
    if (s) {
      const name = group(s, 1);
      const rest = s[2];
      if (name === 'Contexte') {
        section = 'context';
        if (rest !== undefined) context.push(rest);
      } else if (name === 'Options') {
        section = 'options';
      } else if (name === 'Recommandation') {
        section = 'recommendation';
        if (rest !== undefined) recommendation = splitLetter(rest);
      } else {
        section = 'cost';
        if (rest !== undefined) changeCost = rest;
      }
      continue;
    }
    if (section === 'options') {
      if (line.trim() === '') continue;
      const o = OPTION_RE.exec(line);
      if (o) {
        options.push({ letter: group(o, 1), text: group(o, 2) });
        continue;
      }
      const c = CONSEQUENCE_RE.exec(line);
      const last = options[options.length - 1];
      if (c && last) {
        last.consequence = group(c, 1);
        continue;
      }
      return err({ kind: 'bad-option-line', line });
    }
    if (section === 'context') context.push(line);
  }

  if (title === '') return err({ kind: 'missing-title' });

  const card: Card = {
    id,
    kind: a.kind,
    origin: a.origin,
    reversibility: a.reversibility,
    status: a.status,
    skill,
    title,
    context: context.join('\n').trim(),
    options,
  };
  if (recommendation) card.recommendation = recommendation;
  if (changeCost !== undefined) card.changeCost = changeCost;

  const valid = validateCardInput(card);
  return valid.ok ? ok(card) : err(valid.error);
}

function splitLetter(text: string): { letter: string; text: string } {
  const m = /^([A-Z])\.\s*(.*)$/.exec(text);
  return m ? { letter: group(m, 1), text: group(m, 2) } : { letter: '', text };
}

export function serializeCard(card: Card): string {
  const h = HEADINGS[card.kind];
  const lines: string[] = [
    renderMarker(CARD_MARKER, {
      id: card.id,
      kind: card.kind,
      origin: card.origin,
      reversibility: card.reversibility,
      status: card.status,
      skill: card.skill,
    }),
    `### ${h.icon} ${h.word} ${String(cardNumber(card.id))} — ${card.title}`,
    '',
    `**Contexte** — ${card.context}`,
  ];
  if (card.options.length > 0) {
    lines.push('', '**Options**');
    for (const o of card.options) {
      lines.push(`- **${o.letter}.** ${o.text}`);
      if (o.consequence !== undefined) lines.push(`  Conséquence : ${o.consequence}`);
    }
  }
  if (card.recommendation) {
    lines.push(
      '',
      `**Recommandation** — ${card.recommendation.letter}. ${card.recommendation.text}`,
    );
  }
  if (card.changeCost !== undefined) {
    lines.push('', `**Coût d'un changement d'avis** — ${card.changeCost}`);
  }
  return lines.join('\n');
}

/** Change le statut dans le marqueur sans toucher au rendu. */
export function withStatus(card: Card, status: CardStatus): Card {
  return { ...card, status };
}

// ---------------------------------------------------------------------------
// Réponses

export type AnswerChoice =
  { kind: 'option'; letter: string } | { kind: 'keep' | 'reverse' | 'done' | 'other' };

export interface CardAnswer {
  cardId: string;
  choice: AnswerChoice;
  /** Texte libre après le marqueur, transmis intégralement à l'agent. */
  text: string;
}

export type AnswerError =
  | { kind: 'missing-marker' }
  | { kind: 'bad-attr'; attr: string; value: string }
  | { kind: 'choice-not-allowed'; cardKind: CardKind; choice: string }
  | { kind: 'unknown-option'; letter: string }
  | { kind: 'other-requires-text' };

export function parseAnswer(comment: string): Result<CardAnswer, AnswerError> {
  const marker = parseMarker(comment);
  if (marker?.name !== ANSWER_MARKER) return err({ kind: 'missing-marker' });
  const cardId = marker.attrs.card;
  if (cardId === undefined || !/^card-\d+$/.test(cardId)) {
    return err({ kind: 'bad-attr', attr: 'card', value: cardId ?? '' });
  }
  const raw = marker.attrs.choice ?? '';
  let choice: AnswerChoice;
  if (/^[A-Z]$/.test(raw)) choice = { kind: 'option', letter: raw };
  else if (raw === 'keep' || raw === 'reverse' || raw === 'done' || raw === 'other')
    choice = { kind: raw };
  else return err({ kind: 'bad-attr', attr: 'choice', value: raw });
  const text = comment.split('\n').slice(1).join('\n').trim();
  return ok({ cardId, choice, text });
}

export function serializeAnswer(answer: CardAnswer): string {
  const choice = answer.choice.kind === 'option' ? answer.choice.letter : answer.choice.kind;
  const marker = renderMarker(ANSWER_MARKER, { card: answer.cardId, choice });
  return answer.text === '' ? marker : `${marker}\n${answer.text}`;
}

/** Vérifie qu'une réponse est admissible pour la carte visée. */
export function validateAnswer(card: Card, answer: CardAnswer): Result<true, AnswerError> {
  const c = answer.choice;
  const choiceName = c.kind === 'option' ? c.letter : c.kind;
  const allowed: Record<CardKind, readonly string[]> = {
    question: ['option', 'other'],
    arbitration: ['option', 'other'],
    decision: ['keep', 'reverse'],
    action: ['done'],
  };
  if (!allowed[card.kind].includes(c.kind)) {
    return err({ kind: 'choice-not-allowed', cardKind: card.kind, choice: choiceName });
  }
  if (c.kind === 'option' && !card.options.some((o) => o.letter === c.letter)) {
    return err({ kind: 'unknown-option', letter: c.letter });
  }
  if (c.kind === 'other' && answer.text === '') return err({ kind: 'other-requires-text' });
  return ok(true);
}

/** Statut de carte résultant d'une réponse admissible. */
export function statusAfter(answer: CardAnswer): CardStatus {
  switch (answer.choice.kind) {
    case 'keep':
      return 'kept';
    case 'reverse':
      return 'reversed';
    case 'done':
      return 'done';
    default:
      return 'answered';
  }
}

/** « Ça aurait dû me bloquer » dans une réponse `reverse` : ajoute une règle Bloquant. */
export function shouldHaveBlocked(answer: CardAnswer): boolean {
  return answer.choice.kind === 'reverse' && /aurait d[ûu] (me )?bloquer/i.test(answer.text);
}

/** Associe à chaque carte sa première réponse admissible, dans l'ordre des commentaires. */
export function attachAnswers(
  cards: readonly Card[],
  answers: readonly CardAnswer[],
): Map<string, CardAnswer> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out = new Map<string, CardAnswer>();
  for (const answer of answers) {
    const card = byId.get(answer.cardId);
    if (!card || out.has(card.id)) continue;
    if (validateAnswer(card, answer).ok) out.set(card.id, answer);
  }
  return out;
}
