import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { Api } from '../../shared/api';
import { LABELS } from '../labels';
import { send } from '../send';

export interface NewIntentDialogProps {
  api: Pick<Api, 'commands'>;
}

/**
 * Nouvelle intention (H3) : panneau en place dans la barre, pas une modale. L'orchestrateur crée
 * l'issue `phase:intent` avec le texte tel quel ; le titre est obligatoire.
 */
export function NewIntentDialog({ api }: NewIntentDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  function close(): void {
    setOpen(false);
    setTitle('');
    setBody('');
  }

  async function submit(): Promise<void> {
    if (await send(api.commands.createIntent(title.trim(), body))) close();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus aria-hidden className="size-3.5" />
        {LABELS.newIntent}
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label={LABELS.newIntent}
      className="flex flex-col gap-2 rounded border border-neutral-300 p-2 text-xs"
    >
      <input
        aria-label={LABELS.intentTitle}
        placeholder={LABELS.intentTitle}
        className="rounded border border-neutral-300 p-1"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <textarea
        aria-label={LABELS.intentBody}
        placeholder={LABELS.intentBody}
        rows={5}
        className="rounded border border-neutral-300 p-1"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      <span className="flex gap-2">
        <button
          type="button"
          className="rounded bg-neutral-900 px-2 py-1 text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
          disabled={title.trim() === ''}
          onClick={() => {
            void submit();
          }}
        >
          {LABELS.createIssue}
        </button>
        <button type="button" className="rounded px-2 py-1 hover:bg-neutral-100" onClick={close}>
          {LABELS.close}
        </button>
      </span>
    </div>
  );
}
