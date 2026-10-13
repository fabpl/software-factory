import { describe, expect, it } from 'vitest';
import { allowedTools, DEFAULT_POLICY, disallowedTools, factoryToolId } from '../src/index.js';

describe('policy', () => {
  it('autorise lecture, écriture, outils factory et préfixes Bash', () => {
    const allowed = allowedTools(DEFAULT_POLICY);
    expect(allowed).toEqual(
      expect.arrayContaining([
        'Read',
        'Glob',
        'Grep',
        'Edit',
        'Write',
        'mcp__factory',
        'mcp__factory__emit_card',
        'mcp__factory__read_rules',
        'Bash(pnpm:*)',
        'Bash(git status:*)',
        'Bash(git commit:*)',
      ]),
    );
    expect(allowed).not.toContain('Bash');
    expect(allowed.some((t) => t.includes('git push'))).toBe(false);
    expect(factoryToolId('emit_card')).toBe('mcp__factory__emit_card');
  });

  it('interdit web et sous-agents au jalon 1, levable par policy', () => {
    expect(disallowedTools(DEFAULT_POLICY)).toEqual(['WebSearch', 'WebFetch', 'Agent']);
    expect(disallowedTools({ bashPrefixes: [], allowWeb: true })).toEqual(['Agent']);
    expect(disallowedTools({ bashPrefixes: [], allowSubagents: true })).toEqual([
      'WebSearch',
      'WebFetch',
    ]);
    expect(disallowedTools({ bashPrefixes: [], allowWeb: true, allowSubagents: true })).toEqual([]);
  });
});
