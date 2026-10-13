import { describe, expect, it } from 'vitest';
import { parseRunBlock, serializeRunBlock, type RunBlock } from '../src/run.js';

const full =
  '<!-- factory:run session=sess_01abc skill=framing@0.1.0 turns=14 cost_usd=0.42 updated=2026-10-13T10:22:00Z status=waiting card=card-7 -->';

describe('bloc de run', () => {
  it('parse et sérialise à l’identique', () => {
    const r = parseRunBlock(full);
    expect(r).toEqual({
      ok: true,
      value: {
        session: 'sess_01abc',
        skill: 'framing@0.1.0',
        turns: 14,
        costUsd: 0.42,
        updated: '2026-10-13T10:22:00Z',
        status: 'waiting',
        card: 'card-7',
      },
    });
    if (!r.ok) return;
    expect(serializeRunBlock(r.value)).toBe(full);
  });

  it('omet la carte quand absente', () => {
    const b: RunBlock = {
      session: 's',
      skill: 'implementation@0.2.0',
      turns: 0,
      costUsd: 0,
      updated: '2026-10-13T10:22:00Z',
      status: 'finished',
    };
    const text = serializeRunBlock(b);
    expect(text).not.toContain('card=');
    expect(parseRunBlock(text)).toEqual({ ok: true, value: b });
  });

  it('refuse marqueur absent et chaque attribut invalide', () => {
    expect(parseRunBlock('x')).toEqual({ ok: false, error: { kind: 'missing-marker' } });
    const base = {
      session: 's',
      skill: 'f@0.1.0',
      turns: '1',
      cost_usd: '0.1',
      updated: '2026-10-13T10:22:00Z',
      status: 'finished',
    };
    const render = (over: Partial<Record<keyof typeof base, string | undefined>>) => {
      const attrs = { ...base, ...over };
      const parts = Object.entries(attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`);
      return `<!-- factory:run ${parts.join(' ')} -->`;
    };
    const cases: [Partial<Record<keyof typeof base, string | undefined>>, string, string][] = [
      [{ session: undefined }, 'session', ''],
      [{ skill: undefined }, 'skill', ''],
      [{ skill: 'bad' }, 'skill', 'bad'],
      [{ turns: undefined }, 'turns', ''],
      [{ turns: '-1' }, 'turns', '-1'],
      [{ cost_usd: undefined }, 'cost_usd', ''],
      [{ cost_usd: 'x' }, 'cost_usd', 'x'],
      [{ updated: undefined }, 'updated', ''],
      [{ updated: 'hier' }, 'updated', 'hier'],
      [{ status: undefined }, 'status', ''],
      [{ status: 'x' }, 'status', 'x'],
    ];
    for (const [over, attr, value] of cases) {
      expect(parseRunBlock(render(over))).toEqual({
        ok: false,
        error: { kind: 'bad-attr', attr, value },
      });
    }
  });
});
