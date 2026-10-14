import { toast } from 'sonner';
import { LABELS } from './labels';

/** Lance une commande de l'orchestrateur ; un refus s'affiche dans un toast d'erreur. */
export function send(command: Promise<void>): void {
  command.catch((e: unknown) => {
    toast.error(`${LABELS.sendFailed} : ${e instanceof Error ? e.message : String(e)}`);
  });
}
