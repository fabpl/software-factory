/**
 * `pnpm factory <commande>` : pilotage sans interface (T20c, point de contrôle 3).
 *
 *   state                                   état observé, lecture seule
 *   tick                                    un tick, attend la fin du run éventuel
 *   start-framing <issue>
 *   start-implementation <issue>
 *   send-back <issue> <raison>
 *   answer <card> <A|B|…|keep|reverse|done|other> [texte]
 *   validate <issue> <item> <validated|rejected|discussing|pending> [note]
 *   evidence <pr> <critère> <proven|blocked> [note]
 *
 * Options : --repo owner/repo (sinon `gh repo view`), --home <dossier> (sinon $FACTORY_HOME ou ~/.software-factory).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CardAnswer, ItemStatus } from '@factory/conventions';
import { bootstrap } from './bootstrap.js';
import type { Orchestrator } from './orchestrator.js';
import type { CardView, InboxState } from './state.js';

function parseArgs(argv: string[]): {
  command: string;
  args: string[];
  repo?: string;
  home: string;
} {
  const args: string[] = [];
  let repo: string | undefined;
  let home = process.env.FACTORY_HOME ?? join(homedir(), '.software-factory');
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (a === '--repo') repo = argv[++i];
    else if (a === '--home') home = String(argv[++i]);
    else args.push(a);
  }
  const [command = 'state', ...rest] = args;
  return { command, args: rest, home, ...(repo !== undefined ? { repo } : {}) };
}

function choiceOf(raw: string): CardAnswer['choice'] {
  if (/^[A-Z]$/.test(raw)) return { kind: 'option', letter: raw };
  if (raw === 'keep' || raw === 'reverse' || raw === 'done' || raw === 'other')
    return { kind: raw };
  throw new Error(`choix inconnu : ${raw} (lettre, keep, reverse, done ou other)`);
}

function queue(name: string, cards: CardView[]): string {
  if (cards.length === 0) return `${name} : —`;
  return (
    `${name} :\n` +
    cards
      .map((c) => `  ${c.id.padEnd(10)} #${String(c.issue)} ${c.kind.padEnd(11)} ${c.title}`)
      .join('\n')
  );
}

function render(state: InboxState): string {
  if (state.status === 'blocked') {
    return `BLOQUÉ : ${state.blockedReason?.message ?? ''}\n  → ${state.blockedReason?.command ?? ''}`;
  }
  const tasks =
    state.tasks.length === 0
      ? 'Tâches : aucune issue avec une étiquette phase:*'
      : 'Tâches :\n' +
        state.tasks
          .map((t) => {
            const needs = t.needs.length > 0 ? ` needs:${t.needs.join(',')}` : '';
            const lock = t.lock ? (t.lock.active ? ' run:active' : ' run:failed') : '';
            const pr = t.pr
              ? ` PR #${String(t.pr.number)}${t.pr.draft ? ' (brouillon)' : ''} CI ${t.pr.ci.kind}`
              : '';
            return `  #${String(t.issue).padEnd(5)} ${t.phase.padEnd(15)}${needs}${lock}${pr}  ${t.title}`;
          })
          .join('\n');
  const run = state.run
    ? `Run en cours : #${String(state.run.issue)} ${state.run.skill} (${state.run.lastEvent.type})`
    : 'Aucun run en cours';
  const errors = state.errors.length > 0 ? `\nErreurs :\n  ${state.errors.join('\n  ')}` : '';
  return (
    [
      tasks,
      queue('Valider', state.validate),
      queue('Arbitrer', state.arbitrate),
      queue('Agir', state.act),
      run,
    ].join('\n') + errors
  );
}

function streamEvents(orchestrator: Orchestrator): () => void {
  let last: unknown;
  return orchestrator.subscribe((state) => {
    const event = state.run?.lastEvent;
    if (!event || event === last) return;
    last = event;
    const text =
      event.type === 'agent.message'
        ? event.text.replace(/\s+/g, ' ').slice(0, 160)
        : event.type === 'agent.tool'
          ? `${event.tool} ${event.summary}`
          : event.type === 'card.emitted'
            ? `${event.card.kind} « ${event.card.title} »${event.blocking ? ' (bloquante)' : ''}`
            : event.type === 'run.failed'
              ? `${event.reason} ${event.detail}`
              : '';
    console.log(`  [#${String(state.run?.issue ?? 0)}] ${event.type} ${text}`);
  });
}

async function main(): Promise<void> {
  const { command, args, home, repo } = parseArgs(process.argv.slice(2));
  const orchestrator = await bootstrap({ userData: home, ...(repo !== undefined ? { repo } : {}) });
  const need = (n: number, usage: string): void => {
    if (args.length < n) throw new Error(`usage : factory ${command} ${usage}`);
  };
  const arg = (i: number): string => String(args[i]);

  if (command === 'state') {
    console.log(render(await orchestrator.observe()));
    return;
  }
  const stop = streamEvents(orchestrator);
  switch (command) {
    case 'tick':
      await orchestrator.tick();
      break;
    case 'start-framing':
      need(1, '<issue>');
      await orchestrator.startFraming(Number(arg(0)));
      break;
    case 'start-implementation':
      need(1, '<issue>');
      await orchestrator.startImplementation(Number(arg(0)));
      break;
    case 'send-back':
      need(2, '<issue> <raison>');
      await orchestrator.sendBackToFraming(Number(arg(0)), args.slice(1).join(' '));
      break;
    case 'answer': {
      need(2, '<card> <choix> [texte]');
      await orchestrator.tick();
      await orchestrator.answerCard(arg(0), {
        cardId: arg(0),
        choice: choiceOf(arg(1)),
        text: args.slice(2).join(' '),
      });
      break;
    }
    case 'validate': {
      need(3, '<issue> <item> <statut> [note]');
      const note = args.slice(3).join(' ');
      await orchestrator.validateItem(
        Number(arg(0)),
        arg(1),
        arg(2) as ItemStatus,
        note === '' ? undefined : note,
      );
      break;
    }
    case 'evidence': {
      need(3, '<pr> <critère> <proven|blocked> [note]');
      const note = args.slice(3).join(' ');
      await orchestrator.markEvidenceReviewed(
        Number(arg(0)),
        arg(1),
        arg(2) as 'proven' | 'blocked',
        note === '' ? undefined : note,
      );
      break;
    }
    default:
      throw new Error(`commande inconnue : ${command}`);
  }
  await orchestrator.waitForRun();
  stop();
  console.log(render(orchestrator.getState()));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
