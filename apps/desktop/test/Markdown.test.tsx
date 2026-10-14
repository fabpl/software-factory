// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '../src/renderer/components/Markdown';

afterEach(cleanup);

describe('Markdown (C8, D3)', () => {
  it('rend gras, liste et code ; aucune balise <script> ne passe', () => {
    const source = [
      'Un **gras** et du `code`.',
      '',
      '- premier',
      '- second',
      '',
      '<script>window.pwned = true</script>',
    ].join('\n');
    const { container } = render(<Markdown>{source}</Markdown>);
    expect(container.querySelector('strong')?.textContent).toBe('gras');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect([...container.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      'premier',
      'second',
    ]);
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('les liens s’ouvrent hors de la fenêtre', () => {
    const { container } = render(<Markdown>{'[GitHub](https://github.com)'}</Markdown>);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://github.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noreferrer');
  });
});
