import { FACTORY_TOOL_NAMES } from '@factory/conventions';
import { describe, expect, it } from 'vitest';
import {
  hasAttribution,
  loadSkill,
  parseSkill,
  SKILL_NAMES,
  SkillParseError,
} from '../src/index.js';

const ATTRIBUTION =
  "> Adaptée de `interview-me` d'Addy Osmani, https://github.com/addyosmani/agent-skills, licence MIT. Modifié.";

function doc(header: string, body = `${ATTRIBUTION}\n\n# Corps\n`): string {
  return `---\n${header}\n---\n${body}`;
}

const VALID = [
  'name: framing',
  'version: 0.1.0',
  'language: fr',
  'adapted_from: interview-me@0.6.12, spec-driven-development@0.6.12',
  'requires_tools: [emit_card, update_contract, read_rules]',
].join('\n');

function errorOf(text: string): unknown {
  try {
    parseSkill(text);
  } catch (e) {
    return e instanceof SkillParseError ? e.error : e;
  }
  return undefined;
}

describe('parseSkill', () => {
  it('lit un front matter valide', () => {
    const skill = parseSkill(doc(VALID));
    expect(skill).toMatchObject({
      name: 'framing',
      version: '0.1.0',
      language: 'fr',
      adaptedFrom: ['interview-me@0.6.12', 'spec-driven-development@0.6.12'],
      requiresTools: ['emit_card', 'update_contract', 'read_rules'],
    });
    expect(skill.body).toContain('# Corps');
  });

  it('accepte une liste sans crochets et une liste vide', () => {
    const text = doc(VALID.replace('[emit_card, update_contract, read_rules]', 'emit_card'));
    expect(parseSkill(text).requiresTools).toEqual(['emit_card']);
    expect(parseSkill(doc(VALID.replace(/\[.*\]/, '[]'))).requiresTools).toEqual([]);
  });

  it('refuse un document sans front matter', () => {
    expect(errorOf('# Pas de front matter')).toEqual({ kind: 'missing-front-matter' });
  });

  it('refuse une ligne mal formée, une clé inconnue, une clé en double, une clé manquante', () => {
    expect(errorOf(doc(`${VALID}\nbizarre`))).toEqual({ kind: 'bad-line', line: 'bizarre' });
    expect(errorOf(doc(`${VALID}\nauthor: moi`))).toEqual({ kind: 'unknown-key', key: 'author' });
    expect(errorOf(doc(`${VALID}\nname: framing`))).toEqual({
      kind: 'duplicate-key',
      key: 'name',
    });
    expect(errorOf(doc(VALID.replace('language: fr\n', '')))).toEqual({
      kind: 'missing-key',
      key: 'language',
    });
  });

  it('refuse un nom inconnu, une version non semver, une autre langue', () => {
    expect(errorOf(doc(VALID.replace('framing', 'review')))).toEqual({
      kind: 'bad-value',
      key: 'name',
      value: 'review',
    });
    expect(errorOf(doc(VALID.replace('0.1.0', 'v1')))).toEqual({
      kind: 'bad-value',
      key: 'version',
      value: 'v1',
    });
    expect(errorOf(doc(VALID.replace('language: fr', 'language: en')))).toEqual({
      kind: 'bad-value',
      key: 'language',
      value: 'en',
    });
  });

  it('refuse une provenance mal formée ou vide', () => {
    expect(errorOf(doc(VALID.replace('interview-me@0.6.12', 'interview-me')))).toEqual({
      kind: 'bad-value',
      key: 'adapted_from',
      value: 'interview-me',
    });
    expect(errorOf(doc(VALID.replace(/adapted_from: .*/, 'adapted_from: []')))).toEqual({
      kind: 'bad-value',
      key: 'adapted_from',
      value: '',
    });
  });

  it('refuse un outil inconnu', () => {
    expect(errorOf(doc(VALID.replace('read_rules', 'git_push')))).toEqual({
      kind: 'unknown-tool',
      tool: 'git_push',
    });
  });

  it("refuse un corps sans bloc d'attribution", () => {
    expect(errorOf(doc(VALID, '# Corps sans attribution\n'))).toEqual({
      kind: 'missing-attribution',
    });
    expect(hasAttribution('> Adaptée de agent-skills, MIT')).toBe(false);
  });

  it('porte un message lisible', () => {
    expect(() => parseSkill('x')).toThrow(/skill invalide/);
  });
});

describe('skills embarquées', () => {
  for (const name of SKILL_NAMES) {
    it(`${name} : front matter valide, outils connus, attribution présente`, () => {
      const skill = loadSkill(name);
      expect(skill.name).toBe(name);
      expect(skill.language).toBe('fr');
      for (const tool of skill.requiresTools) expect(FACTORY_TOOL_NAMES).toContain(tool);
      expect(skill.requiresTools).toContain('emit_card');
      expect(skill.requiresTools).toContain('read_rules');
      expect(hasAttribution(skill.body)).toBe(true);
      for (const source of skill.adaptedFrom) expect(source).toMatch(/@0\.6\.12$/);
    });

    it(`${name} : structure Vue d'ensemble / Quand / Déroulé / Signaux / Vérification`, () => {
      const { body } = loadSkill(name);
      for (const heading of [
        "## Vue d'ensemble",
        "## Quand l'utiliser",
        '## Déroulé',
        '## Interdits',
        "## Signaux d'alerte",
        '## Vérification',
      ]) {
        expect(body).toContain(heading);
      }
      expect(body).toMatch(/autre appel d'outil dans le tour/);
    });
  }

  it('framing ne touche ni aux preuves ni aux ADR ; implementation ne touche pas au contrat', () => {
    expect(loadSkill('framing').requiresTools).not.toContain('update_evidence');
    expect(loadSkill('framing').requiresTools).not.toContain('request_adr');
    expect(loadSkill('implementation').requiresTools).not.toContain('update_contract');
    expect(loadSkill('implementation').body).toMatch(/jamais\*\* `proven`/);
  });
});
