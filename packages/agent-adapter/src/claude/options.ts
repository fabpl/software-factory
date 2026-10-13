import type { HookCallback, Options, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { RunSpec } from '../events.js';
import { wrapHandlers } from './handlers.js';
import { preToolUse } from './hooks.js';
import { allowedTools, disallowedTools } from './policy.js';
import { createFactoryServer } from './server.js';
import type { RunState } from './state.js';

export const DEFAULT_MAX_TURNS = 200;

/** Seul endroit qui construit des `Options` SDK (SPEC-agent-adapter, Style). */
export function buildOptions(
  spec: RunSpec,
  state: RunState,
  abortController: AbortController,
): Options {
  const hook: HookCallback = (input) =>
    Promise.resolve(preToolUse(input as PreToolUseHookInput, spec.cwd));
  return {
    systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.instructions },
    cwd: spec.cwd,
    settingSources: ['project'],
    permissionMode: 'dontAsk',
    allowedTools: allowedTools(spec.policy),
    disallowedTools: disallowedTools(spec.policy),
    mcpServers: { factory: createFactoryServer(wrapHandlers(spec.tools, state)) },
    // Seul le serveur `factory` : sans ce drapeau, les connecteurs claude.ai de l'utilisateur sont
    // chargés à la reprise de session (cwd sous le dossier personnel) et leur capture de manifeste
    // interrompt l'appel d'outil `factory` en cours (« tool call interrupted », observé le 13 octobre 2026).
    strictMcpConfig: true,
    hooks: {
      PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [hook] }],
    },
    abortController,
    maxTurns: spec.maxTurns ?? DEFAULT_MAX_TURNS,
    ...(spec.maxBudgetUsd !== undefined ? { maxBudgetUsd: spec.maxBudgetUsd } : {}),
    ...(spec.model !== undefined ? { model: spec.model } : {}),
    ...(spec.sessionId !== undefined ? { resume: spec.sessionId } : {}),
  };
}
