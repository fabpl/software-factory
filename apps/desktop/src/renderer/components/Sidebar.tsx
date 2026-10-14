import { PHASES, type Phase } from '@factory/conventions';
import type { InboxState, TaskView } from '@factory/orchestrator';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { Api } from '../../shared/api';
import {
  CI_LABELS,
  LABELS,
  NEED_LABELS,
  PHASE_LABELS,
  formatAge,
  formatStartBlocker,
} from '../labels';
import { send } from '../send';
import { RunIndicator } from './RunIndicator';

export interface SidebarProps {
  state: InboxState;
  api: Pick<Api, 'commands'>;
}

/**
 * Barre latérale : dépôt, dernière synchro, tâches par phase et leurs actions. Fonction pure de
 * l'`InboxState` (H1) : tout ce qui est affiché vient de l'orchestrateur, rien n'est recalculé.
 */
export function Sidebar({ state, api }: SidebarProps) {
  return (
    <aside
      aria-label={LABELS.sidebar}
      className="flex w-72 shrink-0 flex-col gap-3 border-r border-neutral-200 bg-white p-3"
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-neutral-900" title={state.repo.path}>
          {state.repo.slug}
        </span>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          {`${LABELS.lastSync} ${formatAge(state.lastSync.toISOString(), Date.now())}`}
          <button
            type="button"
            aria-label={LABELS.refresh}
            title={LABELS.refresh}
            className="ml-auto rounded p-1 hover:bg-neutral-100"
            onClick={() => {
              send(api.commands.refresh());
            }}
          >
            <RefreshCw aria-hidden className="size-3.5" />
          </button>
        </span>
      </div>
      <RunIndicator run={state.run} api={api} />
      {PHASES.map((phase) => (
        <PhaseGroup
          key={phase}
          phase={phase}
          tasks={state.tasks.filter((t) => t.phase === phase)}
          api={api}
        />
      ))}
    </aside>
  );
}

function PhaseGroup({
  phase,
  tasks,
  api,
}: {
  phase: Phase;
  tasks: readonly TaskView[];
  api: SidebarProps['api'];
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Chevron aria-hidden className="size-3.5" />
        {PHASE_LABELS[phase]}
        <span className="ml-auto rounded-full bg-neutral-200 px-2 text-neutral-700">
          {tasks.length}
        </span>
      </button>
      {open && (
        <ul aria-label={PHASE_LABELS[phase]} className="flex flex-col gap-1">
          {tasks.map((task) => (
            <TaskItem key={task.issue} task={task} api={api} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'amber' }) {
  return (
    <span
      className={
        tone === 'amber'
          ? 'rounded bg-amber-100 px-1.5 text-amber-800'
          : 'rounded bg-neutral-100 px-1.5 text-neutral-700'
      }
    >
      {children}
    </span>
  );
}

function prState(pr: NonNullable<TaskView['pr']>): string {
  if (pr.merged) return LABELS.prMerged;
  return pr.draft ? LABELS.prDraft : LABELS.prReady;
}

function TaskItem({ task, api }: { task: TaskView; api: SidebarProps['api'] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-neutral-200">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full flex-col gap-1 p-2 text-left text-sm hover:bg-neutral-50"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span>
          {LABELS.issue(task.issue)} {task.title}
        </span>
        <span className="flex flex-wrap gap-1 text-xs">
          {task.lock?.active === true && <Badge tone="amber">{LABELS.lockActive}</Badge>}
          {task.lock?.failed === true && <Badge tone="amber">{LABELS.lockFailed}</Badge>}
          {task.needs.map((need) => (
            <Badge key={need}>{NEED_LABELS[need]}</Badge>
          ))}
          {task.pr && <Badge>{`${LABELS.pr(task.pr.number)} · ${prState(task.pr)}`}</Badge>}
          {task.pr && <Badge>{CI_LABELS[task.pr.ci.kind]}</Badge>}
        </span>
      </button>
      {open && <TaskActions task={task} api={api} />}
    </li>
  );
}

const buttonClass =
  'rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:bg-neutral-300';

/** Actions selon la phase ; les raisons de grisage viennent de `startBlockers` (H2). */
function TaskActions({ task, api }: { task: TaskView; api: SidebarProps['api'] }) {
  const [reason, setReason] = useState('');
  const { commands } = api;
  return (
    <div
      role="group"
      aria-label={LABELS.issue(task.issue)}
      className="flex flex-col gap-2 border-t border-neutral-100 p-2 text-xs"
    >
      {task.phase === 'intent' && (
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            send(commands.startFraming(task.issue));
          }}
        >
          {LABELS.startFraming}
        </button>
      )}
      {task.phase === 'framing' && (
        <>
          <button
            type="button"
            className={buttonClass}
            disabled={task.startBlockers.length > 0}
            onClick={() => {
              send(commands.startImplementation(task.issue));
            }}
          >
            {LABELS.startImplementation}
          </button>
          {task.startBlockers.length > 0 && (
            <ul className="list-disc pl-4 text-neutral-500">
              {task.startBlockers.map((b) => {
                const text = formatStartBlocker(b);
                return <li key={text}>{text}</li>;
              })}
            </ul>
          )}
        </>
      )}
      {task.phase !== 'intent' && task.phase !== 'framing' && (
        <>
          <textarea
            aria-label={LABELS.reason}
            placeholder={LABELS.reason}
            rows={2}
            className="rounded border border-neutral-300 p-1"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={reason.trim() === ''}
            onClick={() => {
              send(commands.sendBackToFraming(task.issue, reason.trim()));
            }}
          >
            {LABELS.sendBackToFraming}
          </button>
        </>
      )}
      <a href={task.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
        {LABELS.openInGitHub}
      </a>
    </div>
  );
}
