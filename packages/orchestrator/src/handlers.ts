import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FactoryToolHandlers } from '@factory/agent-adapter';
import {
  adrFilename,
  labelsFor,
  nextAdrNumber,
  parseContract,
  parseEvidence,
  parseLabels,
  queueFor,
  renderAdr,
  serializeCard,
  serializeEvidence,
  validateAgentEvidence,
  validateCardInput,
  writeContract,
  type AdrRequest,
  type Card,
  type CardInput,
  type CardOrigin,
  type Contract,
  type ContractInput,
  type ContractItem,
  type Evidence,
  type EvidenceInput,
  type Need,
  type Queue,
} from '@factory/conventions';
import { findMarked, findPull, upsertMarked, type GitHubPort } from './github.js';
import { appendRule, readRules } from './rules.js';
import { nextCardId } from './state.js';
import type { Worktree, WorktreePort } from './worktree.js';

/**
 * Les cinq handlers de SPEC-orchestrator. Ils écrivent dans GitHub via `conventions` et dans le
 * worktree via `simple-git` ; l'adaptateur les expose à l'agent sans savoir ce qu'ils font.
 */

export interface HandlerContext {
  github: GitHubPort;
  worktrees: WorktreePort;
  issue: number;
  title: string;
  /** `framing@0.1.0` */
  skill: string;
  origin: CardOrigin;
  worktree: Worktree;
  defaultBranch: string;
  clock: () => Date;
  /** PR connue au lancement du run, si elle existe déjà. */
  pull?: PullRef;
}

export interface PullRef {
  number: number;
}

export interface Handlers extends FactoryToolHandlers {
  /** PR brouillon créée ou retrouvée pendant le run. */
  pull(): PullRef | undefined;
}

const NEED_FOR_QUEUE: Record<Queue, Need> = {
  validate: 'validation',
  arbitrate: 'arbitration',
  act: 'action',
};
const KIND_OF_PREFIX: Record<string, ContractItem['kind']> = {
  H: 'hypothesis',
  D: 'decision',
  C: 'criterion',
};

export class HandlerError extends Error {}

/** Date lisible à la française : « 13 octobre 2026 ». */
export function frenchDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Refus de `update_contract` : identifiant mal formé, type incohérent, doublon, item disparu
 * (les identifiants ne sont jamais réutilisés), item rejeté reformulé, critère sans preuve prévue.
 */
export function checkContractItems(
  current: Contract | undefined,
  items: readonly ContractItem[],
): string | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (!/^[HDC]\d+$/.test(item.id)) return `identifiant invalide : ${item.id}`;
    if (KIND_OF_PREFIX[item.id.charAt(0)] !== item.kind)
      return `type incohérent pour ${item.id} (${item.kind})`;
    if (seen.has(item.id)) return `identifiant en double : ${item.id}`;
    seen.add(item.id);
    if (item.kind === 'criterion' && (item.plannedProof ?? '').trim() === '')
      return `critère sans preuve prévue : ${item.id}`;
  }
  for (const old of current?.items ?? []) {
    const now = items.find((i) => i.id === old.id);
    if (!now)
      return `item disparu : ${old.id} (les identifiants ne sont jamais réutilisés ; marque-le rejected)`;
    if (old.status === 'rejected' && (now.text !== old.text || now.status !== 'rejected')) {
      return `item rejeté réécrit : ${old.id} (crée un nouvel identifiant)`;
    }
  }
  return undefined;
}

/** Fusionne les lignes de l'agent avec les `proven` existantes : l'agent ne rétrograde jamais une preuve. */
export function mergeEvidence(
  existing: Evidence | undefined,
  agent: EvidenceInput,
  contract: number,
  skill: string,
): Evidence {
  const proven = new Map(
    (existing?.lines ?? []).filter((l) => l.state === 'proven').map((l) => [l.criterion, l]),
  );
  return {
    contract,
    skill,
    lines: agent.lines.map((l) => proven.get(l.criterion) ?? l),
  };
}

export function createHandlers(ctx: HandlerContext): Handlers {
  let pull = ctx.pull;
  const { github, issue } = ctx;

  async function ensurePull(commitMessage: string): Promise<PullRef> {
    if (pull) return pull;
    const found = findPull(await github.listPulls(), issue);
    if (found?.state === 'open') {
      pull = found;
      return found;
    }
    await ctx.worktrees.commitAll(ctx.worktree.path, commitMessage, { allowEmpty: true });
    await ctx.worktrees.push(ctx.worktree.path, ctx.worktree.branch);
    pull = await github.createDraftPull({
      head: ctx.worktree.branch,
      base: ctx.defaultBranch,
      title: `#${String(issue)} ${ctx.title}`,
      body: `Closes #${String(issue)}`,
    });
    return pull;
  }

  async function commitAndPush(message: string): Promise<void> {
    await ctx.worktrees.commitAll(ctx.worktree.path, message);
    await ctx.worktrees.push(ctx.worktree.path, ctx.worktree.branch);
  }

  async function addNeed(need: Need): Promise<void> {
    const current = await github.getIssue(issue);
    if (!current) throw new HandlerError(`issue #${String(issue)} introuvable`);
    const labels = parseLabels(current.labels);
    if (!labels.ok) throw new HandlerError(`étiquettes incohérentes sur #${String(issue)}`);
    if (labels.value.needs.has(need)) return;
    const needs = new Set(labels.value.needs);
    needs.add(need);
    await github.setLabels(issue, labelsFor({ ...labels.value, needs }));
  }

  async function currentContract(): Promise<{ body: string; contract: Contract | undefined }> {
    const current = await github.getIssue(issue);
    if (!current) throw new HandlerError(`issue #${String(issue)} introuvable`);
    const parsed = parseContract(current.body);
    return { body: current.body, contract: parsed.ok ? parsed.value : undefined };
  }

  return {
    pull: () => pull,

    async emit_card(input: CardInput) {
      const valid = validateCardInput(input);
      if (!valid.ok) throw new HandlerError(`carte invalide : ${JSON.stringify(valid.error)}`);
      const target =
        ctx.origin === 'framing'
          ? issue
          : (await ensurePull(`feat(#${String(issue)}): ${input.title}`)).number;
      const comments = [
        ...(await github.listComments(issue)),
        ...(target === issue ? [] : await github.listComments(target)),
      ];
      const cards = comments.flatMap((c) => {
        const parsed = parseCardLoose(c.body);
        return parsed ? [{ card: parsed }] : [];
      });
      const card: Card = {
        ...input,
        id: nextCardId(cards),
        origin: ctx.origin,
        status: 'open',
        skill: ctx.skill,
      };
      await github.createComment(target, serializeCard(card));
      await addNeed(NEED_FOR_QUEUE[queueFor(card.kind)]);
      return { cardId: card.id };
    },

    async update_contract(input: ContractInput) {
      const { body, contract } = await currentContract();
      const problem = checkContractItems(contract, input.items);
      if (problem !== undefined) throw new HandlerError(`contrat refusé : ${problem}`);
      const next: Contract = {
        version: (contract?.version ?? 0) + 1,
        skill: ctx.skill,
        items: input.items,
      };
      await github.updateIssueBody(issue, writeContract(body, next));
    },

    async update_evidence(input: EvidenceInput) {
      const valid = validateAgentEvidence({ contract: 1, skill: ctx.skill, lines: input.lines });
      if (!valid.ok) throw new HandlerError(`preuves refusées : ${JSON.stringify(valid.error)}`);
      const { contract } = await currentContract();
      if (!contract) throw new HandlerError(`aucun contrat sur #${String(issue)}`);
      const criteria = input.lines.map((l) => l.criterion).join(', ');
      const pr = await ensurePull(`feat(#${String(issue)}): ${criteria}`);
      await commitAndPush(`feat(#${String(issue)}): ${criteria}`);
      const existing = findMarked(
        await github.listComments(pr.number),
        (name) => name === 'evidence',
      );
      const parsedExisting = existing ? parseEvidence(existing.body) : undefined;
      const merged = mergeEvidence(
        parsedExisting?.ok === true ? parsedExisting.value : undefined,
        input,
        contract.version,
        ctx.skill,
      );
      await upsertMarked(
        github,
        pr.number,
        (name) => name === 'evidence',
        serializeEvidence(merged),
      );
    },

    async request_adr(input: AdrRequest) {
      const dir = join(ctx.worktree.path, 'docs', 'adr');
      mkdirSync(dir, { recursive: true });
      const number = nextAdrNumber(readdirSync(dir));
      const date = ctx.clock();
      const file = join(dir, adrFilename(number, input.slug));
      const { cardId, slug, ...adr } = input;
      writeFileSync(file, renderAdr({ ...adr, number, status: 'accepté', date: frenchDate(date) }));
      const iso = date.toISOString().slice(0, 10);
      appendRule(
        ctx.worktree.path,
        'Tranché',
        `${iso} · #${String(issue)} · ${input.title} : ${input.decision} (ADR ${String(number).padStart(4, '0')}, carte ${cardId})`,
      );
      await commitAndPush(
        `docs(#${String(issue)}): ADR ${String(number).padStart(4, '0')} ${slug}`,
      );
    },

    read_rules() {
      return Promise.resolve(readRules(ctx.worktree.path));
    },
  };
}

/** Une carte même partiellement invalide compte pour la numérotation : son identifiant est pris. */
function parseCardLoose(body: string): Card | undefined {
  const m = /<!--\s*factory:card\s[^>]*\bid=(card-\d+)/.exec(body);
  return m ? ({ id: String(m[1]) } as Card) : undefined;
}
