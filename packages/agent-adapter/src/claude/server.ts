import {
  CARD_KINDS,
  EVIDENCE_STATES,
  ITEM_KINDS,
  ITEM_STATUSES,
  REVERSIBILITIES,
} from '@factory/conventions';
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { WrappedHandlers } from './handlers.js';
import { FACTORY_SERVER } from './policy.js';

const option = z.object({
  letter: z.string().regex(/^[A-Z]$/),
  text: z.string().min(1),
  consequence: z.string().optional(),
});

export const CARD_SHAPE = {
  kind: z.enum(CARD_KINDS),
  title: z.string().min(1),
  context: z.string(),
  options: z.array(option),
  recommendation: z.object({ letter: z.string(), text: z.string() }).optional(),
  changeCost: z.string().optional(),
  reversibility: z.enum(REVERSIBILITIES),
};

export const CONTRACT_SHAPE = {
  items: z.array(
    z.object({
      id: z.string().regex(/^[HDC]\d+$/),
      kind: z.enum(ITEM_KINDS),
      text: z.string().min(1),
      status: z.enum(ITEM_STATUSES),
      note: z.string().optional(),
      plannedProof: z.string().optional(),
    }),
  ),
};

export const EVIDENCE_SHAPE = {
  lines: z.array(
    z.object({
      criterion: z.string().regex(/^C\d+$/),
      proof: z.string(),
      state: z.enum(EVIDENCE_STATES),
      note: z.string().optional(),
    }),
  ),
};

export const ADR_SHAPE = {
  cardId: z.string(),
  slug: z.string().min(1),
  title: z.string().min(1),
  origin: z.string(),
  reversibility: z.string(),
  question: z.string(),
  context: z.string(),
  options: z.array(
    z.object({ letter: z.string(), label: z.string(), pros: z.string(), cons: z.string() }),
  ),
  chosen: z.string(),
  decision: z.string(),
  consequences: z.array(z.string()),
};

function text(content: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: content }] };
}

/**
 * Retire les clés `undefined` que zod laisse sur les champs optionnels, pour satisfaire
 * `exactOptionalPropertyTypes` côté `conventions`. Le type cible est celui du handler appelé.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T est le type du handler appelé
export function compact<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v: unknown) => compact<unknown>(v)) as T;
  if (typeof value !== 'object' || value === null) return value as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = compact<unknown>(v);
  }
  return out as T;
}

/** Serveur MCP `factory` en process : les cinq outils de SPEC-skills. */
export function createFactoryServer(handlers: WrappedHandlers): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: FACTORY_SERVER,
    version: '0.1.0',
    tools: [
      tool(
        'emit_card',
        "Publie une carte pour l'humain (question, arbitration, action : le run s'arrête ; decision : continue). Au moins deux options et une recommandation.",
        CARD_SHAPE,
        async (args) => text(await handlers.emit_card(compact(args))),
      ),
      tool(
        'update_contract',
        'Réécrit le bloc contrat avec la liste complète des items H/D/C, leur statut et la preuve prévue des critères.',
        CONTRACT_SHAPE,
        async (args) => text(await handlers.update_contract(compact(args))),
      ),
      tool(
        'update_evidence',
        'Réécrit le commentaire preuves avec la liste complète critère → preuve, état (pending, to-review, blocked ; jamais proven).',
        EVIDENCE_SHAPE,
        async (args) => text(await handlers.update_evidence(compact(args))),
      ),
      tool(
        'request_adr',
        'Demande la création de docs/adr/NNNN-<slug>.md pour une arbitration irréversible répondue.',
        ADR_SHAPE,
        async (args) => text(await handlers.request_adr(compact(args))),
      ),
      tool(
        'read_rules',
        'Retourne .factory/rules.md du dépôt cible (Tranché, Bloquant), ou vide.',
        {},
        async () => text(await handlers.read_rules()),
      ),
    ],
  });
}
