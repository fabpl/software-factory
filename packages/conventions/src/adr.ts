export interface AdrOption {
  letter: string;
  label: string;
  pros: string;
  cons: string;
}

export interface AdrInput {
  number: number;
  title: string;
  status: string;
  /** Date lisible, par exemple « 13 octobre 2026 ». */
  date: string;
  origin: string;
  reversibility: string;
  question: string;
  context: string;
  options: readonly AdrOption[];
  /** Lettre de l'option retenue, mise en gras dans le tableau. */
  chosen: string;
  decision: string;
  consequences: readonly string[];
}

export function formatAdrNumber(n: number): string {
  return String(n).padStart(4, '0');
}

/** Numéro suivant à partir des noms de fichiers présents dans `docs/adr/`. */
export function nextAdrNumber(filenames: readonly string[]): number {
  let max = 0;
  for (const name of filenames) {
    const m = /^(\d{4})-/.exec(name);
    if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function adrFilename(number: number, title: string): string {
  return `${formatAdrNumber(number)}-${slugify(title)}.md`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Rend un ADR au format de `docs/adr/0001-electron-typescript.md`. */
export function renderAdr(input: AdrInput): string {
  const rows = input.options.map((o) => {
    const head = `${o.letter}. ${o.label}`;
    const cell = o.letter === input.chosen ? `**${head}**` : head;
    return `| ${escapeCell(cell)} | ${escapeCell(o.pros)} | ${escapeCell(o.cons)} |`;
  });
  const consequences = input.consequences.map((c) => `- ${c}`);

  return [
    `# ADR ${formatAdrNumber(input.number)} — ${input.title}`,
    '',
    `**Statut :** ${input.status} — ${input.date}`,
    `**Origine :** ${input.origin}`,
    `**Réversibilité :** ${input.reversibility}`,
    '',
    '## Question',
    '',
    input.question,
    '',
    '## Contexte',
    '',
    input.context,
    '',
    '## Options',
    '',
    '| Option | Pour | Contre |',
    '|---|---|---|',
    ...rows,
    '',
    '## Décision',
    '',
    `**${input.chosen}.** ${input.decision}`,
    '',
    '## Conséquences',
    '',
    ...consequences,
    '',
  ].join('\n');
}
