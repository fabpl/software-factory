import { isBlocking, type CardKind } from '@factory/conventions';
import { relative, resolve, sep } from 'node:path';
import { factoryToolId } from './policy.js';
import type { RunState } from './state.js';

/** Sous-ensemble de `PreToolUseHookInput` que les hooks lisent ; plain object, testable sans SDK. */
export interface PreToolUseInput {
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
}

export type Decision = 'allow' | 'deny' | 'defer';

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision: Decision;
    permissionDecisionReason: string;
    updatedInput?: Record<string, unknown>;
  };
}

const EMIT_CARD = factoryToolId('emit_card');
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FORBIDDEN_COMMANDS: readonly { re: RegExp; why: string }[] = [
  { re: /\bgit\s+push\b/, why: "git push est réservé à l'orchestrateur" },
  { re: /(^|[\s;&|(])gh\s/, why: "gh est réservé à l'orchestrateur" },
  { re: /\bcurl\b/, why: 'pas de réseau depuis le run' },
  { re: /\bwget\b/, why: 'pas de réseau depuis le run' },
];
const RM_RF =
  /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*)\s+(.*)$/m;

function decide(
  permissionDecision: Decision,
  permissionDecisionReason: string,
  updatedInput?: Record<string, unknown>,
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
      ...(updatedInput ? { updatedInput } : {}),
    },
  };
}

export function insideWorktree(cwd: string, target: string): boolean {
  const root = resolve(cwd);
  const path = resolve(root, target);
  const rel = relative(root, path);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  return !rel.split(sep).includes('.git');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Hook `PreToolUse` : `defer` sur carte bloquante, `allow` + réponse à la reprise, `deny` sur l'interdit. */
export function preToolUse(input: PreToolUseInput, state: RunState, cwd: string): HookOutput {
  const args = asRecord(input.tool_input);

  if (input.tool_name === EMIT_CARD) {
    if (!isBlocking(args.kind as CardKind)) return {};
    const answer = state.takeAnswer();
    if (answer) return decide('allow', 'reprise avec la réponse humaine', { ...args, answer });
    return decide('defer', "carte bloquante : le run s'arrête en attendant l'humain");
  }

  if (input.tool_name === 'Bash') {
    const command = typeof args.command === 'string' ? args.command : '';
    for (const { re, why } of FORBIDDEN_COMMANDS) {
      if (re.test(command)) return decide('deny', why);
    }
    const rm = RM_RF.exec(command);
    if (rm) {
      const targets = String(rm[1])
        .split(/\s+/)
        .filter((t) => t !== '' && !t.startsWith('-'));
      if (targets.some((t) => !insideWorktree(cwd, t))) {
        return decide('deny', 'rm -rf hors du worktree');
      }
    }
    return {};
  }

  if (WRITE_TOOLS.has(input.tool_name)) {
    const target = args.file_path ?? args.notebook_path;
    if (typeof target !== 'string' || !insideWorktree(cwd, target)) {
      return decide('deny', 'écriture hors du worktree ou dans .git/');
    }
  }
  return {};
}
