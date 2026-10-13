import type { FactoryEvent, RunFailureReason } from '../events.js';
import { factoryToolId, FACTORY_SERVER } from './policy.js';
import type { RunState } from './state.js';

/**
 * Formes minimales de `SDKMessage` que la traduction lit. Déclarées ici pour que `translate`
 * reste une fonction pure testable sur des fixtures JSON, sans charger le SDK.
 */
export interface SdkInitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  tools: string[];
  mcp_servers: { name: string; status: string }[];
}
export interface SdkAssistantMessage {
  type: 'assistant';
  session_id: string;
  message: { content: ContentBlock[] | string };
}
export interface SdkUserMessage {
  type: 'user';
  session_id: string;
  message: { content: ContentBlock[] | string };
}
export interface SdkResultMessage {
  type: 'result';
  subtype:
    | 'success'
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries';
  session_id: string;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  stop_reason?: string | null;
  terminal_reason?: string;
  deferred_tool_use?: { id: string; name: string; input: Record<string, unknown> };
  errors?: string[];
  result?: string;
}
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: string };

export type SdkMessageLike =
  | SdkInitMessage
  | SdkAssistantMessage
  | SdkUserMessage
  | SdkResultMessage
  | { type: string; subtype?: string };

export interface TranslateContext {
  requiredTools: readonly string[];
}

const SUMMARY_MAX = 120;

export function truncate(text: string, max = SUMMARY_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** Résumé court d'un appel d'outil, par outil (chemin, commande, titre de carte). */
export function summarize(name: string, input: unknown): string {
  const args =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const str = (k: string): string | undefined => {
    const v = args[k];
    return typeof v === 'string' ? v : undefined;
  };
  const text =
    str('file_path') ??
    str('notebook_path') ??
    str('command') ??
    str('title') ??
    str('pattern') ??
    str('path') ??
    (Object.keys(args).length === 0 ? '' : JSON.stringify(args));
  return truncate(text);
}

export function missingTools(msg: SdkInitMessage, required: readonly string[]): string[] {
  const missing = required.map(factoryToolId).filter((id) => !msg.tools.includes(id));
  const server = msg.mcp_servers.find((s) => s.name === FACTORY_SERVER);
  if (server?.status !== 'connected') missing.push(`serveur ${FACTORY_SERVER} non connecté`);
  return missing;
}

function failureReason(subtype: SdkResultMessage['subtype']): RunFailureReason {
  switch (subtype) {
    case 'error_max_turns':
      return 'max_turns';
    case 'error_max_budget_usd':
      return 'budget';
    default:
      return 'execution';
  }
}

/**
 * `SDKMessage` → `FactoryEvent[]` (table de SPEC-agent-adapter). Zéro ou plusieurs événements par message.
 * L'arrêt sur carte bloquante n'est pas traité ici : l'adaptateur convertit `run.finished` en `run.waiting`.
 */
export function translate(
  msg: SdkMessageLike,
  state: RunState,
  ctx: TranslateContext,
): FactoryEvent[] {
  const { runId } = state;
  switch (msg.type) {
    case 'system': {
      if (msg.subtype !== 'init') return [];
      const init = msg as SdkInitMessage;
      state.sessionId = init.session_id;
      const missing = missingTools(init, ctx.requiredTools);
      if (missing.length > 0) {
        return [
          {
            type: 'run.failed',
            runId,
            sessionId: init.session_id,
            reason: 'tools_missing',
            detail: `outils requis absents : ${missing.join(', ')}`,
          },
        ];
      }
      return [
        {
          type: 'run.started',
          runId,
          sessionId: init.session_id,
          model: init.model,
          tools: init.tools,
        },
      ];
    }
    case 'assistant': {
      const events: FactoryEvent[] = [];
      for (const block of blocksOf(msg as SdkAssistantMessage)) {
        if (block.type === 'text' && 'text' in block && block.text.trim() !== '') {
          events.push({ type: 'agent.message', runId, text: block.text });
        } else if (block.type === 'tool_use' && 'id' in block) {
          state.toolUses.set(block.id, { name: block.name, input: block.input });
        }
      }
      return events;
    }
    case 'user': {
      const events: FactoryEvent[] = [];
      for (const block of blocksOf(msg as SdkUserMessage)) {
        if (block.type !== 'tool_result' || !('tool_use_id' in block)) continue;
        const use = state.toolUses.get(block.tool_use_id);
        if (!use) continue;
        state.toolUses.delete(block.tool_use_id);
        events.push({
          type: 'agent.tool',
          runId,
          tool: use.name,
          summary: summarize(use.name, use.input),
          ok: block.is_error !== true,
        });
      }
      return events;
    }
    case 'result': {
      const result = msg as SdkResultMessage;
      state.sessionId = result.session_id;
      if (result.subtype !== 'success') {
        return [
          {
            type: 'run.failed',
            runId,
            sessionId: result.session_id,
            reason: failureReason(result.subtype),
            detail: (result.errors ?? []).join(' ; ') || result.subtype,
          },
        ];
      }
      return [
        {
          type: 'run.finished',
          runId,
          sessionId: result.session_id,
          turns: result.num_turns,
          costUsd: result.total_cost_usd,
        },
      ];
    }
    default:
      return [];
  }
}

function blocksOf(msg: SdkAssistantMessage | SdkUserMessage): ContentBlock[] {
  const content = msg.message.content;
  return typeof content === 'string' ? [] : content;
}
