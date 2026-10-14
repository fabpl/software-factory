import { toast } from 'sonner';
import { LABELS } from './labels';

/**
 * Lance une commande de l'orchestrateur ; un refus s'affiche dans un toast d'erreur.
 * Résout `true` si la commande a abouti.
 */
export async function send(command: Promise<void>): Promise<boolean> {
  try {
    await command;
    return true;
  } catch (e) {
    toast.error(`${LABELS.sendFailed} : ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
