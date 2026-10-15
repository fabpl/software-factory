import { join } from 'node:path';
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Boucle complète en mode `fake` (C1) : l'app construite démarre sur `out/main/e2e.js`
 * (`bootstrapFake`, D2), le test ne passe que par rôles et libellés français et attend chaque
 * état publié par les ticks de 500 ms (H8), sans pause fixe ni « Rafraîchir ».
 */

const ROOT = join(import.meta.dirname, '..');

function column(page: Page, name: string): Locator {
  return page.getByRole('region', { name: new RegExp(`^${name}`) });
}

/** `title` : début du titre ; le bouton qui déplie la carte le contient après type et issue. */
function card(scope: Locator, title: string): Locator {
  return scope.getByRole('article', { name: title });
}

/** Déplie la carte puis clique le bouton de réponse ; elle quitte sa colonne au prochain état. */
async function answer(scope: Locator, title: string, button: string): Promise<void> {
  const target = card(scope, title);
  await target.getByRole('button', { name: title }).click();
  await target
    .getByRole('group', { name: 'Réponse' })
    .getByRole('button', { name: button })
    .click();
  await expect(target).toHaveCount(0);
}

/** Déplie la tâche #1 dans la barre latérale puis lance l'action demandée. */
async function startFromSidebar(page: Page, action: string): Promise<void> {
  const sidebar = page.getByRole('complementary', { name: 'Tâches' });
  await sidebar.getByRole('button', { name: /^#1 Lire les étiquettes sans Project/ }).click();
  const launch = sidebar.getByRole('group', { name: '#1' }).getByRole('button', { name: action });
  await expect(launch).toBeEnabled();
  await launch.click();
}

test('de l’intention à « Fusionner la PR »', async () => {
  const app = await electron.launch({ args: [join(ROOT, 'out', 'main', 'e2e.js')], cwd: ROOT });
  try {
    const page = await app.firstWindow();
    // H8 : 15 s par étape ; `use.actionTimeout` ne s'applique pas à une page Electron.
    page.setDefaultTimeout(15_000);
    const arbitrate = column(page, 'Arbitrer');
    const validate = column(page, 'Valider');
    const act = column(page, 'Agir');

    await startFromSidebar(page, 'Lancer le cadrage');
    await answer(arbitrate, "Où stocker l'état ?", 'GitHub seulement');
    await answer(arbitrate, "Faut-il une capture d'écran ?", 'Oui');
    for (const id of ['H2', 'D1', 'C1', 'C2']) await answer(validate, `${id} — `, 'Valider');

    await startFromSidebar(page, 'Lancer l’implémentation');
    await answer(arbitrate, 'Nouvelle dépendance de production', 'Parseur maison');
    await answer(validate, 'Nom du module', 'Garder');
    await answer(validate, 'C2 — ', 'Prouvé');

    await expect(card(act, 'Fusionner la PR')).toBeVisible();
  } finally {
    await app.close();
  }
});
