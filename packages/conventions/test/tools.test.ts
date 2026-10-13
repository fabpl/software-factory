import { describe, expect, it } from 'vitest';
import { FACTORY_TOOL_NAMES, isFactoryToolName } from '../src/tools.js';

describe('tools', () => {
  it('expose les cinq outils de la spec skills', () => {
    expect(FACTORY_TOOL_NAMES).toEqual([
      'emit_card',
      'update_contract',
      'update_evidence',
      'request_adr',
      'read_rules',
    ]);
  });

  it('reconnaît un nom d’outil', () => {
    expect(isFactoryToolName('emit_card')).toBe(true);
    expect(isFactoryToolName('git_push')).toBe(false);
  });
});
