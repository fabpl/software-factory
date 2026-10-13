import { describe, expect, it } from 'vitest';
import { insideWorktree, preToolUse } from '../src/claude/hooks.js';
import { RunState } from '../src/claude/state.js';
import { DECISION, QUESTION } from './helpers.js';

const CWD = '/tmp/wt';
const call = (tool_name: string, tool_input: unknown, state = new RunState('run-1')) =>
  preToolUse({ tool_name, tool_input, tool_use_id: 'toolu_1' }, state, CWD);
const decision = (out: ReturnType<typeof call>) => out.hookSpecificOutput?.permissionDecision;

describe('hook PreToolUse — emit_card', () => {
  it('diffère une carte bloquante sans réponse', () => {
    const out = call('mcp__factory__emit_card', QUESTION);
    expect(decision(out)).toBe('defer');
    expect(out.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it('laisse passer une carte bloquante avec la réponse armée, et la consomme', () => {
    const state = new RunState('run-1');
    const answer = { cardId: 'card-1', choice: { kind: 'option' as const, letter: 'B' }, text: '' };
    state.pendingAnswer = answer;
    const out = call('mcp__factory__emit_card', QUESTION, state);
    expect(decision(out)).toBe('allow');
    expect(out.hookSpecificOutput?.updatedInput).toEqual({ ...QUESTION, answer });
    expect(decision(call('mcp__factory__emit_card', QUESTION, state))).toBe('defer');
  });

  it('ne touche pas une decision', () => {
    expect(call('mcp__factory__emit_card', DECISION)).toEqual({});
    expect(call('mcp__factory__emit_card', 'pas un objet')).toEqual({});
  });
});

describe('hook PreToolUse — Bash', () => {
  it.each([
    ['git push origin main', 'git push'],
    ['pnpm test && git push', 'git push'],
    ['gh pr create', 'gh'],
    ['echo x; gh api repos', 'gh'],
    ['curl https://x', 'réseau'],
    ['wget https://x', 'réseau'],
    ['rm -rf /', 'worktree'],
    ['rm -rf ../autre', 'worktree'],
    ['rm -fr node_modules /tmp/ailleurs', 'worktree'],
  ])('refuse « %s »', (command, why) => {
    const out = call('Bash', { command });
    expect(decision(out)).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(why);
  });

  it.each([
    'pnpm test',
    'git status',
    'rm -rf node_modules dist',
    'rm -rf',
    'rm -rf -- coverage',
    'echo ghost',
    'cat .github/workflows/ci.yml',
  ])('laisse passer « %s »', (command) => {
    expect(call('Bash', { command })).toEqual({});
  });

  it('tolère une commande absente', () => {
    expect(call('Bash', {})).toEqual({});
  });
});

describe('hook PreToolUse — écritures', () => {
  it.each(['Write', 'Edit', 'MultiEdit'])('%s dans le worktree passe', (tool) => {
    expect(call(tool, { file_path: `${CWD}/src/a.ts` })).toEqual({});
    expect(call(tool, { file_path: 'src/relatif.ts' })).toEqual({});
  });

  it('NotebookEdit lit notebook_path', () => {
    expect(call('NotebookEdit', { notebook_path: `${CWD}/n.ipynb` })).toEqual({});
  });

  it.each([[`${CWD}/.git/config`], ['/etc/passwd'], [`${CWD}/../voisin/x.ts`], [undefined]])(
    'refuse %s',
    (file_path) => {
      expect(decision(call('Write', { file_path }))).toBe('deny');
    },
  );
});

describe('insideWorktree et autres outils', () => {
  it('le worktree lui-même est dedans, .git est dehors', () => {
    expect(insideWorktree(CWD, CWD)).toBe(true);
    expect(insideWorktree(CWD, '.')).toBe(true);
    expect(insideWorktree(CWD, '.git')).toBe(false);
    expect(insideWorktree(CWD, 'src/.git/x')).toBe(false);
    expect(insideWorktree(CWD, 'src/.gitignore')).toBe(true);
  });

  it('les autres outils passent', () => {
    expect(call('Read', { file_path: '/etc/hosts' })).toEqual({});
    expect(call('Glob', { pattern: '**/*' })).toEqual({});
  });
});
