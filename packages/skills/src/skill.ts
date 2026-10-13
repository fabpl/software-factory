import { isFactoryToolName, type FactoryToolName } from '@factory/conventions';

export const SKILL_NAMES = ['framing', 'implementation'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface Skill {
  name: SkillName;
  /** semver */
  version: string;
  language: string;
  /** `interview-me@0.6.12`, … */
  adaptedFrom: string[];
  requiresTools: FactoryToolName[];
  /** Markdown après le front matter, attribution comprise. */
  body: string;
}

export type SkillError =
  | { kind: 'missing-front-matter' }
  | { kind: 'bad-line'; line: string }
  | { kind: 'unknown-key'; key: string }
  | { kind: 'duplicate-key'; key: string }
  | { kind: 'missing-key'; key: string }
  | { kind: 'bad-value'; key: string; value: string }
  | { kind: 'unknown-tool'; tool: string }
  | { kind: 'missing-attribution' };

export class SkillParseError extends Error {
  constructor(public readonly error: SkillError) {
    super(`skill invalide : ${JSON.stringify(error)}`);
  }
}

const KEYS = ['name', 'version', 'language', 'adapted_from', 'requires_tools'] as const;
type Key = (typeof KEYS)[number];
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const LINE_RE = /^([a-z_]+): (.+?)\s*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SOURCE_RE = /^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/;
const LIST_RE = /^\[(.*)\]$/;

function isKey(k: string): k is Key {
  return (KEYS as readonly string[]).includes(k);
}

function splitList(value: string): string[] {
  return value
    .replace(LIST_RE, '$1')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Un `SKILL.md` doit commencer par un bloc d'attribution (SPEC-skills, « Provenance »). */
export function hasAttribution(body: string): boolean {
  const head = String(body.trimStart().split('\n\n')[0]);
  return head.includes('addyosmani/agent-skills') && head.includes('MIT') && /modifi/i.test(head);
}

export function parseSkill(text: string): Skill {
  const fm = FRONT_MATTER_RE.exec(text);
  if (!fm) throw new SkillParseError({ kind: 'missing-front-matter' });
  const header = String(fm[1]);
  const body = String(fm[2]);
  const values = new Map<Key, string>();
  for (const line of header.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) throw new SkillParseError({ kind: 'bad-line', line });
    const key = String(m[1]);
    const value = String(m[2]);
    if (!isKey(key)) throw new SkillParseError({ kind: 'unknown-key', key });
    if (values.has(key)) throw new SkillParseError({ kind: 'duplicate-key', key });
    values.set(key, value);
  }
  for (const key of KEYS) {
    if (!values.has(key)) throw new SkillParseError({ kind: 'missing-key', key });
  }
  const get = (key: Key): string => String(values.get(key));

  const name = get('name');
  if (!(SKILL_NAMES as readonly string[]).includes(name)) {
    throw new SkillParseError({ kind: 'bad-value', key: 'name', value: name });
  }
  const version = get('version');
  if (!SEMVER_RE.test(version)) {
    throw new SkillParseError({ kind: 'bad-value', key: 'version', value: version });
  }
  const language = get('language');
  if (language !== 'fr') {
    throw new SkillParseError({ kind: 'bad-value', key: 'language', value: language });
  }
  const adaptedFrom = splitList(get('adapted_from'));
  for (const source of adaptedFrom) {
    if (!SOURCE_RE.test(source)) {
      throw new SkillParseError({ kind: 'bad-value', key: 'adapted_from', value: source });
    }
  }
  if (adaptedFrom.length === 0) {
    throw new SkillParseError({ kind: 'bad-value', key: 'adapted_from', value: '' });
  }
  const requiresTools: FactoryToolName[] = [];
  for (const tool of splitList(get('requires_tools'))) {
    if (!isFactoryToolName(tool)) throw new SkillParseError({ kind: 'unknown-tool', tool });
    requiresTools.push(tool);
  }
  if (!hasAttribution(body)) throw new SkillParseError({ kind: 'missing-attribution' });

  return { name: name as SkillName, version, language, adaptedFrom, requiresTools, body };
}
