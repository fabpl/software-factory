import {
  findDelimitedBlock,
  renderClosingMarker,
  renderMarker,
  replaceDelimitedBlock,
} from './block.js';
import { group } from './regex.js';
import { err, ok, type Result } from './result.js';

export const ITEM_STATUSES = ['pending', 'validated', 'rejected', 'discussing'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_KINDS = ['hypothesis', 'decision', 'criterion'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ContractItem {
  /** `H1`, `D2`, `C3` : stable pour la vie de l'issue. */
  id: string;
  kind: ItemKind;
  text: string;
  status: ItemStatus;
  /** Texte libre entre parenthèses après le statut, par exemple `carte #3`. */
  note?: string;
  /** Obligatoire pour un critère. */
  plannedProof?: string;
}

export interface Contract {
  version: number;
  /** `framing@0.1.0` */
  skill: string;
  items: ContractItem[];
}

export type ContractError =
  | { kind: 'missing' }
  | { kind: 'bad-attrs'; detail: string }
  | { kind: 'unknown-section'; line: string }
  | { kind: 'bad-line'; line: string }
  | { kind: 'unknown-status'; id: string; status: string }
  | { kind: 'duplicate-id'; id: string }
  | { kind: 'id-kind-mismatch'; id: string; section: ItemKind }
  | { kind: 'criterion-without-proof'; id: string };

export const BLOCK_NAME = 'contract';

const SECTION_TITLES: Record<ItemKind, string> = {
  hypothesis: '### Hypothèses',
  decision: '### Décisions',
  criterion: "### Critères d'acceptation",
};

const KIND_PREFIX: Record<ItemKind, string> = { hypothesis: 'H', decision: 'D', criterion: 'C' };
const PREFIX_KIND: Record<string, ItemKind> = { H: 'hypothesis', D: 'decision', C: 'criterion' };

const ITEM_RE = /^- \[( |x|X)\] \*\*([HDC]\d+)\*\* — (.+?) `([a-z-]+)`(?: \((.+)\))?\s*$/;
const PROOF_RE = /^\s+Preuve prévue : (.+?)\s*$/;

function isStatus(s: string): s is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(s);
}

export function parseContract(body: string): Result<Contract, ContractError> {
  const block = findDelimitedBlock(body, BLOCK_NAME);
  if (!block) return err({ kind: 'missing' });

  const version = Number(block.attrs.version);
  const skill = block.attrs.skill;
  if (!Number.isInteger(version) || version < 1) {
    return err({ kind: 'bad-attrs', detail: `version=${block.attrs.version ?? ''}` });
  }
  if (skill === undefined || !/^[a-z-]+@\d+\.\d+\.\d+$/.test(skill)) {
    return err({ kind: 'bad-attrs', detail: `skill=${skill ?? ''}` });
  }

  const items: ContractItem[] = [];
  const seen = new Set<string>();
  let section: ItemKind | undefined;
  let last: ContractItem | undefined;

  for (const line of block.inner.split('\n')) {
    if (line.trim() === '' || line.trim() === '## Contrat') continue;

    if (line.startsWith('### ')) {
      const kind = (Object.keys(SECTION_TITLES) as ItemKind[]).find(
        (k) => SECTION_TITLES[k] === line.trim(),
      );
      if (!kind) return err({ kind: 'unknown-section', line });
      section = kind;
      last = undefined;
      continue;
    }

    const proof = PROOF_RE.exec(line);
    if (proof?.[1] !== undefined && last?.kind === 'criterion') {
      last.plannedProof = proof[1];
      continue;
    }

    const m = ITEM_RE.exec(line);
    if (!m || section === undefined) return err({ kind: 'bad-line', line });
    // Les groupes 1 à 4 existent toujours quand l'expression correspond ; le 5 est optionnel.
    const box = group(m, 1);
    const id = group(m, 2);
    const text = group(m, 3);
    const statusToken = group(m, 4);
    const note = m[5];
    if (seen.has(id)) return err({ kind: 'duplicate-id', id });
    seen.add(id);
    const kind = PREFIX_KIND[id.charAt(0)];
    if (kind !== section) return err({ kind: 'id-kind-mismatch', id, section });
    if (!isStatus(statusToken)) return err({ kind: 'unknown-status', id, status: statusToken });

    // La case cochée à la main vaut validation ; décochée, elle retire la validation.
    const checked = box !== ' ';
    let status: ItemStatus = statusToken;
    if (checked && status !== 'validated') status = 'validated';
    if (!checked && status === 'validated') status = 'pending';

    const item: ContractItem = { id, kind, text, status };
    if (note !== undefined) item.note = note;
    items.push(item);
    last = item;
  }

  for (const item of items) {
    if (item.kind === 'criterion' && item.plannedProof === undefined) {
      return err({ kind: 'criterion-without-proof', id: item.id });
    }
  }

  return ok({ version, skill, items });
}

/** Rend le bloc complet, marqueurs compris. */
export function serializeContract(contract: Contract): string {
  const lines: string[] = [
    renderMarker(BLOCK_NAME, { version: String(contract.version), skill: contract.skill }),
    '## Contrat',
  ];
  for (const kind of ITEM_KINDS) {
    lines.push('', SECTION_TITLES[kind]);
    for (const item of contract.items.filter((i) => i.kind === kind)) {
      const box = item.status === 'validated' ? 'x' : ' ';
      const note = item.note !== undefined ? ` (${item.note})` : '';
      lines.push(`- [${box}] **${item.id}** — ${item.text} \`${item.status}\`${note}`);
      if (item.kind === 'criterion') lines.push(`  Preuve prévue : ${item.plannedProof ?? ''}`);
    }
  }
  lines.push(renderClosingMarker(BLOCK_NAME));
  return lines.join('\n');
}

/** Réécrit le bloc dans le corps de l'issue, le reste du corps intact. */
export function writeContract(body: string, contract: Contract): string {
  return replaceDelimitedBlock(body, BLOCK_NAME, serializeContract(contract));
}

export type StartBlocker =
  { kind: 'item-not-settled'; id: string; status: ItemStatus } | { kind: 'no-validated-criterion' };

/** Passage en `implementation` : zéro pending, zéro discussing, au moins un critère validé. */
export function canStartImplementation(contract: Contract): Result<true, StartBlocker[]> {
  const blockers: StartBlocker[] = [];
  for (const item of contract.items) {
    if (item.status === 'pending' || item.status === 'discussing') {
      blockers.push({ kind: 'item-not-settled', id: item.id, status: item.status });
    }
  }
  if (!contract.items.some((i) => i.kind === 'criterion' && i.status === 'validated')) {
    blockers.push({ kind: 'no-validated-criterion' });
  }
  return blockers.length === 0 ? ok(true) : err(blockers);
}

/** Identifiant suivant d'un type, jamais réutilisé même après rejet. */
export function nextItemId(contract: Contract, kind: ItemKind): string {
  const prefix = KIND_PREFIX[kind];
  let max = 0;
  for (const item of contract.items) {
    if (item.kind === kind) max = Math.max(max, Number(item.id.slice(1)));
  }
  return `${prefix}${String(max + 1)}`;
}
