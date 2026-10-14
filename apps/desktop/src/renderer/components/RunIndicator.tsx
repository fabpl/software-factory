import type { RunView } from '@factory/orchestrator';
import { LoaderCircle, Square } from 'lucide-react';
import { useState } from 'react';
import type { Api } from '../../shared/api';
import { EVENT_LABELS, LABELS, formatDuration, formatSkill } from '../labels';
import { send } from '../send';

export interface RunIndicatorProps {
  run: RunView | undefined;
  api: Pick<Api, 'commands'>;
}

/** Une ligne : le résumé de l'outil, ou la première ligne du message. */
function summary(event: NonNullable<RunView['lastAgentEvent']>): string {
  return event.type === 'agent.tool' ? event.summary : String(event.text.split('\n')[0]);
}

/**
 * Run en cours (H8) : tâche, skill, durée, dernier geste de l'agent et type du dernier événement.
 * « Annuler » passe par une confirmation avant `cancelRun` (C5). Sans run, rien.
 */
export function RunIndicator({ run, api }: RunIndicatorProps) {
  const [confirming, setConfirming] = useState(false);
  if (!run) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded border border-blue-200 bg-blue-50 p-2 text-xs"
    >
      <span className="flex items-center gap-2 text-neutral-800">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        <span className="font-medium">{LABELS.issue(run.issue)}</span>
        <span>{formatSkill(run.skill)}</span>
        <span className="ml-auto text-neutral-500">
          {LABELS.since(formatDuration(run.startedAt, Date.now()))}
        </span>
      </span>
      {run.lastAgentEvent && (
        <span className="truncate text-neutral-700">{summary(run.lastAgentEvent)}</span>
      )}
      <span className="flex items-center gap-2 text-neutral-500">
        <span>{EVENT_LABELS[run.lastEvent.type]}</span>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-red-700 hover:bg-red-50"
          onClick={() => {
            setConfirming(true);
          }}
        >
          <Square aria-hidden className="size-3" />
          {LABELS.cancelRun}
        </button>
      </span>
      {confirming && (
        <div
          role="dialog"
          aria-labelledby="cancel-run-title"
          className="flex flex-col gap-2 rounded border border-red-200 bg-white p-2"
        >
          <p id="cancel-run-title" className="font-medium text-neutral-900">
            {LABELS.cancelConfirmTitle}
          </p>
          <p className="text-neutral-600">{LABELS.cancelConfirmText}</p>
          <span className="flex gap-2">
            <button
              type="button"
              className="rounded bg-red-700 px-2 py-1 text-white"
              onClick={() => {
                setConfirming(false);
                void send(api.commands.cancelRun());
              }}
            >
              {LABELS.cancelConfirm}
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 hover:bg-neutral-100"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {LABELS.cancelKeep}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
