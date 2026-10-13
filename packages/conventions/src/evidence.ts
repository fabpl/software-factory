import { parseMarker, renderMarker } from './block.js';
import type { Contract } from './contract.js';
import { group } from './regex.js';
import { err, ok, type Result } from './result.js';

export const EVIDENCE_STATES = ['pending', 'proven', 'to-review', 'blocked', 'missing'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** États que l'agent a le droit d'écrire. */
export const AGENT_EVIDENCE_STATES: readonly EvidenceState[] = ['pending', 'to-review', 'blocked'];

export interface EvidenceLine {
  criterion: string;
  /** Markdown libre : lien, identifiant de test, `—` si rien. */
  proof: string;
  state: EvidenceState;
  note?: string;
}

export interface Evidence {
  /** Version du contrat à laquelle les lignes se rapportent. */
  contract: number;
  lines: EvidenceLine[];
}

export type EvidenceError =
  | { kind: 'missing-marker' }
  | { kind: 'bad-attr'; attr: string; value: string }
  | { kind: 'bad-row'; line: string }
  | { kind: 'unknown-state'; criterion: string; state: string }
  | { kind: 'duplicate-criterion'; criterion: string }
  | { kind: 'state-not-allowed-for-agent'; criterion: string; state: EvidenceState }
  | { kind: 'proven-without-url'; criterion: string };

export const EVIDENCE_MARKER = 'evidence';

const ROW_RE = /^\| (C\d+) \| (.*?) \| `([a-z-]+)`(?: : (.*?))? \|$/;
const URL_RE = /\]\((https?:\/\/[^)\s]+)\)/;

function isState(s: string): s is EvidenceState {
  return (EVIDENCE_STATES as readonly string[]).includes(s);
}

export function parseEvidence(comment: string): Result<Evidence, EvidenceError> {
  const marker = parseMarker(comment);
  if (marker?.name !== EVIDENCE_MARKER) return err({ kind: 'missing-marker' });
  const contract = Number(marker.attrs.contract);
  if (!Number.isInteger(contract) || contract < 1) {
    return err({ kind: 'bad-attr', attr: 'contract', value: marker.attrs.contract ?? '' });
  }
  const lines: EvidenceLine[] = [];
  const seen = new Set<string>();
  for (const line of comment.split('\n').slice(1)) {
    if (!/^\| C\d+ \|/.test(line)) continue;
    const m = ROW_RE.exec(line);
    if (!m) return err({ kind: 'bad-row', line });
    const criterion = group(m, 1);
    const state = group(m, 3);
    if (seen.has(criterion)) return err({ kind: 'duplicate-criterion', criterion });
    seen.add(criterion);
    if (!isState(state)) return err({ kind: 'unknown-state', criterion, state });
    const entry: EvidenceLine = { criterion, proof: group(m, 2), state };
    const note = m[4];
    if (note !== undefined) entry.note = note;
    lines.push(entry);
  }
  return ok({ contract, lines });
}

export function serializeEvidence(evidence: Evidence): string {
  const rows = evidence.lines.map((l) => {
    const note = l.note !== undefined ? ` : ${l.note}` : '';
    return `| ${l.criterion} | ${l.proof} | \`${l.state}\`${note} |`;
  });
  return [
    renderMarker(EVIDENCE_MARKER, { contract: String(evidence.contract) }),
    '## Preuves',
    '',
    '| Critère | Preuve | État |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
}

export function hasUrl(proof: string): boolean {
  return URL_RE.test(proof);
}

/** Ce que l'agent soumet via `update_evidence` : jamais `proven`, jamais `missing`. */
export function validateAgentEvidence(evidence: Evidence): Result<true, EvidenceError> {
  for (const l of evidence.lines) {
    if (!AGENT_EVIDENCE_STATES.includes(l.state)) {
      return err({ kind: 'state-not-allowed-for-agent', criterion: l.criterion, state: l.state });
    }
  }
  return ok(true);
}

/** Une ligne `proven` doit pointer vers une URL hors du commentaire. */
export function validateProven(evidence: Evidence): Result<true, EvidenceError> {
  for (const l of evidence.lines) {
    if (l.state === 'proven' && !hasUrl(l.proof)) {
      return err({ kind: 'proven-without-url', criterion: l.criterion });
    }
  }
  return ok(true);
}

/** État par critère validé du contrat ; absent du commentaire = `missing`. */
export function evidenceByCriterion(
  contract: Contract,
  evidence: Evidence | undefined,
): Map<string, EvidenceState> {
  const out = new Map<string, EvidenceState>();
  const lines = new Map(evidence?.lines.map((l) => [l.criterion, l.state]) ?? []);
  for (const item of contract.items) {
    if (item.kind !== 'criterion' || item.status !== 'validated') continue;
    out.set(item.id, lines.get(item.id) ?? 'missing');
  }
  return out;
}

export function missingFor(contract: Contract, evidence: Evidence | undefined): string[] {
  return [...evidenceByCriterion(contract, evidence)]
    .filter(([, state]) => state === 'missing')
    .map(([id]) => id);
}

/** Passage en `verdict` : tout est `proven`. */
export function canReachVerdict(contract: Contract, evidence: Evidence | undefined): boolean {
  const states = [...evidenceByCriterion(contract, evidence).values()];
  return states.length > 0 && states.every((s) => s === 'proven');
}

/** Passage en `evidence` : plus rien à produire côté agent ni CI. */
export function canReachEvidencePhase(contract: Contract, evidence: Evidence | undefined): boolean {
  const states = [...evidenceByCriterion(contract, evidence).values()];
  return states.length > 0 && states.every((s) => s === 'proven' || s === 'to-review');
}
