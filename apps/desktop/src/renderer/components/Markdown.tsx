import ReactMarkdown, { type Components } from 'react-markdown';

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 underline">
      {children}
    </a>
  ),
};

/**
 * Seul point d'entrée de `react-markdown` (D3) : sans `rehype-raw`, le HTML brut du texte de
 * l'agent est ignoré, jamais injecté dans le DOM.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm text-neutral-700 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown components={COMPONENTS} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
