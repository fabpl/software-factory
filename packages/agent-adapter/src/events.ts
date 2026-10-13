import type {
  AdrRequest,
  CardAnswer,
  CardInput,
  ContractInput,
  EvidenceInput,
  FactoryToolName,
} from '@factory/conventions';

/**
 * Vocabulaire d'événements : **le** contrat entre adaptateurs et cœur (SPEC-agent-adapter).
 * Rien ici ne nomme un concept Claude Code. Toute extension passe par « demander d'abord ».
 */
export type FactoryEvent =
  | { type: 'run.started'; runId: string; sessionId: string; model: string; tools: string[] }
  | { type: 'agent.message'; runId: string; text: string }
  | { type: 'agent.tool'; runId: string; tool: string; summary: string; ok: boolean }
  | { type: 'card.emitted'; runId: string; card: CardInput; blocking: boolean }
  | { type: 'contract.updated'; runId: string; contract: ContractInput }
  | { type: 'evidence.updated'; runId: string; evidence: EvidenceInput }
  | { type: 'adr.requested'; runId: string; adr: AdrRequest }
  | { type: 'run.waiting'; runId: string; sessionId: string; cardId: string }
  | { type: 'run.finished'; runId: string; sessionId: string; turns: number; costUsd: number }
  | {
      type: 'run.failed';
      runId: string;
      sessionId?: string;
      reason: RunFailureReason;
      detail: string;
    };

export type RunFailureReason = 'max_turns' | 'budget' | 'execution' | 'tools_missing' | 'cancelled';

export const TERMINAL_EVENT_TYPES = ['run.waiting', 'run.finished', 'run.failed'] as const;

export function isTerminal(event: FactoryEvent): boolean {
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(event.type);
}

/** Les cinq handlers fournis par l'orchestrateur. L'adaptateur les expose à l'agent et observe. */
export interface FactoryToolHandlers {
  /** Publie la carte ; retourne l'identifiant attribué (`card-7`). */
  emit_card(card: CardInput): Promise<{ cardId: string }>;
  update_contract(input: ContractInput): Promise<void>;
  update_evidence(input: EvidenceInput): Promise<void>;
  request_adr(input: AdrRequest): Promise<void>;
  /** `.factory/rules.md` du dépôt cible, ou chaîne vide. */
  read_rules(): Promise<string>;
}

export interface Policy {
  /** Préfixes de commandes Bash autorisés (`pnpm`, `git status`…). */
  bashPrefixes: readonly string[];
  /** Jalon 1 : faux. */
  allowWeb?: boolean;
  /** Jalon 1 : faux. */
  allowSubagents?: boolean;
}

export const DEFAULT_POLICY: Policy = {
  bashPrefixes: [
    'pnpm',
    'npm test',
    'npx vitest',
    'git status',
    'git diff',
    'git log',
    'git add',
    'git commit',
    'ls',
    'cat',
  ],
};

export interface RunSpec {
  runId: string;
  /** Worktree. */
  cwd: string;
  /** Skill + contrat + règles, assemblé par `@factory/skills`. */
  instructions: string;
  /** Intention ou consigne de reprise. */
  prompt: string;
  /** Bloc de run, si reprise. */
  sessionId?: string;
  /** Depuis le front matter de la skill. */
  requiredTools: readonly FactoryToolName[];
  tools: FactoryToolHandlers;
  policy: Policy;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface AgentAdapter {
  readonly id: 'claude-code' | 'codex' | 'fake';
  start(spec: RunSpec): AsyncIterable<FactoryEvent>;
  resume(spec: RunSpec, answer: CardAnswer): AsyncIterable<FactoryEvent>;
  cancel(runId: string): Promise<void>;
}
