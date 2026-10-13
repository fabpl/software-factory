import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `.factory/rules.md` du dépôt cible (SPEC-skills, « Boucle d'apprentissage »). */

export const RULES_PATH = join('.factory', 'rules.md');
export type RuleSection = 'Tranché' | 'Bloquant';

const HEADER = '# Règles du projet (générées, éditables)';

/** Ajoute `line` sous `## <section>`, en créant l'en-tête et la section au besoin. Pure. */
export function addRuleLine(content: string, section: RuleSection, line: string): string {
  const text = content.trim() === '' ? HEADER + '\n' : content.replace(/\s+$/, '') + '\n';
  const heading = `## ${section}`;
  const entry = `- ${line}`;
  if (text.includes(entry + '\n') || text.endsWith(entry + '\n')) return text;
  const lines = text.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) return `${text}\n${heading}\n${entry}\n`;
  let end = at + 1;
  while (end < lines.length && !lines[end]?.startsWith('## ')) end += 1;
  while (end > at + 1 && lines[end - 1]?.trim() === '') end -= 1;
  lines.splice(end, 0, entry);
  return lines.join('\n');
}

export function readRules(worktreePath: string): string {
  const file = join(worktreePath, RULES_PATH);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export function appendRule(worktreePath: string, section: RuleSection, line: string): void {
  const file = join(worktreePath, RULES_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, addRuleLine(readRules(worktreePath), section, line));
}
