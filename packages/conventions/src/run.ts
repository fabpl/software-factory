import { parseMarker, renderMarker } from './block.js';
import { err, ok, type Result } from './result.js';

export const RUN_BLOCK_STATUSES = ['waiting', 'finished', 'failed'] as const;
export type RunBlockStatus = (typeof RUN_BLOCK_STATUSES)[number];

export interface RunBlock {
  session: string;
  skill: string;
  turns: number;
  costUsd: number;
  /** ISO 8601. */
  updated: string;
  status: RunBlockStatus;
  /** Carte qui a arrêté le run, si `waiting`. */
  card?: string;
}

export type RunBlockError =
  { kind: 'missing-marker' } | { kind: 'bad-attr'; attr: string; value: string };

export const RUN_MARKER = 'run';

function isStatus(s: string | undefined): s is RunBlockStatus {
  return s !== undefined && (RUN_BLOCK_STATUSES as readonly string[]).includes(s);
}

export function parseRunBlock(comment: string): Result<RunBlock, RunBlockError> {
  const marker = parseMarker(comment);
  if (marker?.name !== RUN_MARKER) return err({ kind: 'missing-marker' });
  const a = marker.attrs;
  const session = a.session;
  if (session === undefined || session === '')
    return err({ kind: 'bad-attr', attr: 'session', value: '' });
  const skill = a.skill;
  if (skill === undefined || !/^[a-z-]+@\d+\.\d+\.\d+$/.test(skill)) {
    return err({ kind: 'bad-attr', attr: 'skill', value: skill ?? '' });
  }
  const turns = Number(a.turns);
  if (!Number.isInteger(turns) || turns < 0)
    return err({ kind: 'bad-attr', attr: 'turns', value: a.turns ?? '' });
  const costUsd = Number(a.cost_usd);
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    return err({ kind: 'bad-attr', attr: 'cost_usd', value: a.cost_usd ?? '' });
  }
  const updated = a.updated;
  if (updated === undefined || Number.isNaN(Date.parse(updated))) {
    return err({ kind: 'bad-attr', attr: 'updated', value: updated ?? '' });
  }
  if (!isStatus(a.status)) return err({ kind: 'bad-attr', attr: 'status', value: a.status ?? '' });
  const block: RunBlock = { session, skill, turns, costUsd, updated, status: a.status };
  if (a.card !== undefined) block.card = a.card;
  return ok(block);
}

export function serializeRunBlock(block: RunBlock): string {
  const attrs: Record<string, string> = {
    session: block.session,
    skill: block.skill,
    turns: String(block.turns),
    cost_usd: block.costUsd.toFixed(2),
    updated: block.updated,
    status: block.status,
  };
  if (block.card !== undefined) attrs.card = block.card;
  return renderMarker(RUN_MARKER, attrs);
}
