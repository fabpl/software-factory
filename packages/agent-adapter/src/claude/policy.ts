import { FACTORY_TOOL_NAMES } from '@factory/conventions';
import type { Policy } from '../events.js';

export const FACTORY_SERVER = 'factory';

export function factoryToolId(name: string): string {
  return `mcp__${FACTORY_SERVER}__${name}`;
}

/** Outils permis sans confirmation (`permissionMode: 'dontAsk'` refuse tout le reste). */
export function allowedTools(policy: Policy): string[] {
  return [
    'Read',
    'Glob',
    'Grep',
    'Edit',
    'Write',
    `mcp__${FACTORY_SERVER}`,
    ...FACTORY_TOOL_NAMES.map(factoryToolId),
    ...policy.bashPrefixes.map((prefix) => `Bash(${prefix}:*)`),
  ];
}

/** Jalon 1 : ni web, ni sous-agents, sauf levée explicite par la `policy`. */
export function disallowedTools(policy: Policy): string[] {
  const out: string[] = [];
  if (!policy.allowWeb) out.push('WebSearch', 'WebFetch');
  if (!policy.allowSubagents) out.push('Agent');
  return out;
}
