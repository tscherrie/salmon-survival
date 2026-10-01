import { expect, test, type Page } from '@playwright/test';

/**
 * Sammelt Konsolen- und Seitenfehler (Warnungen sind erlaubt). Ausgenommen: Meldungen, die Playwrights
 * eigener Trace-Recorder in sandboxed `srcdoc`-iframes auslöst (kein Fehler der App).
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    if (location === 'about:srcdoc' && message.text().startsWith('Blocked script execution')) return;
    errors.push(`${message.text()} @ ${location}:${message.location().lineNumber}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('Demo-Projekt: Timeline-Klick → Chip → Senden → Rückfrage → Checkpoint → neue Version', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Musikvideo „Nachtfahrt“/ }).click();

  const timeline = page.getByTestId('timeline');
  await expect(timeline).toBeVisible();

  // Klick auf die Videospur → Zeit-Referenz als Chip im Composer
  const lane = page.locator('[data-lane-track="V1"]');
  const box = await lane.boundingBox();
  if (!box) throw new Error('Spur V1 nicht sichtbar');
  await page.mouse.click(box.x + 260, box.y + box.height / 2);
  const editor = page.getByTestId('composer-editor');
  await expect(editor.locator('.chip')).toHaveCount(1);
  await expect(editor.locator('.chip-time')).toContainText('⏱ 00:');

  // Text dahinter tippen und senden
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mach diese Stelle dunkler');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(editor.locator('.chip')).toHaveCount(0);

  const panel = page.getByRole('complementary', { name: 'Director' });
  await expect(panel.locator('.msg-user').last().locator('.chip')).toHaveCount(1);
  await expect(panel.locator('.msg-user').last()).toContainText('Mach diese Stelle dunkler');

  // Gestreamte Antwort des Directors
  await expect(panel.locator('.msg-director').last()).toContainText('Bevor ich ein Treatment schreibe');

  // Rückfrage beantworten
  const question = panel.getByRole('form', { name: 'Rückfrage' });
  await expect(question).toBeVisible();
  await question.getByLabel('YouTube (16:9)').check();
  await question.getByLabel('Neon-Noir').check();
  await question.getByRole('button', { name: 'Antworten' }).click();
  await expect(question).toHaveCount(0);

  // Checkpoint mit geändertem Budget freigeben
  const card = panel.getByRole('article', { name: /Checkpoint zur Freigabe: Treatment/ });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByLabel('Beantragtes Budget (USD)').fill('15');
  await card.getByRole('button', { name: 'Freigeben (Budget $15.00)' }).click();

  // Neue Version erscheint im Versionswähler
  const versionButton = page.getByRole('button', { name: 'Versionen: v4' });
  await expect(versionButton).toBeVisible({ timeout: 15_000 });
  await versionButton.click();
  await expect(page.locator('.version-row[data-version="4"]')).toContainText('Treatment umgesetzt');
  await page.keyboard.press('Escape');

  // Header zeigt den freigegebenen Checkpoint
  await expect(page.locator('.step-approved')).toHaveCount(1);
  await expect(panel.locator('.msg-director').last()).toContainText('v4');

  await page.screenshot({ path: 'e2e/test-results/workspace-after-flow.png' });
  expect(errors).toEqual([]);
});

test('Alle Demo-Kategorien öffnen ohne Konsolenfehler (Screenshot-Check, 1280×800)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Director Studio' })).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/start.png' });

  const projects: Array<[RegExp, string]> = [
    [/Musikvideo/, 'video'],
    [/Pitch-Deck Q4/, 'deck'],
    [/Plakat Sommerfest/, 'canvas'],
    [/Café Morgenrot/, 'web'],
    [/Podcast Folge 12/, 'audio'],
  ];
  for (const [name, id] of projects) {
    await page.getByRole('button', { name }).first().click();
    await expect(page.getByRole('region', { name: 'Bühne (nur lesbar)' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Asset-Browser' })).toBeVisible();
    await page.waitForTimeout(400);
    // Das Layout darf bei 1280×800 nicht horizontal überlaufen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontaler Überlauf in ${id}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `e2e/test-results/workspace-${id}.png` });
    await page.getByRole('button', { name: 'Projekte' }).click();
    await expect(page.getByRole('heading', { name: 'Zuletzt geöffnet' })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Neues Projekt anlegen und Präsentation: Folienklick erzeugt Folien-Chip', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neues Projekt' });
  await dialog.getByLabel('Titel').fill('E2E-Testprojekt');
  await dialog.getByLabel('Präsentation').check();
  await dialog.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'E2E-Testprojekt' })).toBeVisible();

  await page.getByRole('button', { name: 'Projekte' }).click();
  await page.getByRole('button', { name: /Pitch-Deck Q4/ }).click();
  await page.getByRole('button', { name: /Folie 2: Wo wir stehen/ }).click();
  await expect(page.getByTestId('composer-editor').locator('.chip-slide')).toContainText('Folie 2');
  expect(errors).toEqual([]);
});

test('Projekt ohne Kategorie: Planungs-Platzhalter → Kategorie im Gespräch; fehlende Datei erneut verknüpfen', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neues Projekt' });
  await dialog.getByLabel('Titel').fill('Offene Idee');
  await dialog.getByLabel('Noch offen – im Gespräch klären').check();
  await dialog.getByRole('button', { name: 'Projekt anlegen' }).click();

  // Ohne Dokument: Platzhalter auf der Bühne, Planungsgespräch im Director-Panel
  const stage = page.getByRole('region', { name: 'Bühne (nur lesbar)' });
  await expect(stage.getByTestId('stage-planning')).toContainText('Kategorie wird im Planungsgespräch festgelegt');
  await page.getByTestId('composer-editor').click();
  await page.keyboard.type('Etwas für den Sommer');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const question = page.getByRole('complementary', { name: 'Director' }).getByRole('form', { name: 'Rückfrage' });
  await expect(question).toBeVisible();
  await question.getByLabel('Präsentation').check();
  await question.getByLabel('Beides').check();
  await question.getByLabel('Analogfilm').check();
  await question.getByRole('button', { name: 'Antworten' }).click();
  await expect(stage.getByTestId('stage-planning')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.badge-category')).toHaveText('Präsentation');

  // Demo-Deck: verknüpftes Logo fehlt → „Erneut verknüpfen …“ (Dateiauswahl des Fakes)
  await page.getByRole('button', { name: 'Projekte' }).click();
  await page.getByRole('button', { name: /Pitch-Deck Q4/ }).click();
  const logo = page.locator('[data-asset-id="ast_deck_logo"]');
  await expect(logo).toContainText('Datei fehlt');
  await logo.getByRole('button', { name: 'Firmenlogo – Details' }).click();
  const drawer = page.getByRole('complementary', { name: 'Details: Firmenlogo' });
  await expect(drawer.getByRole('alert')).toContainText('Datei nicht gefunden');
  await drawer.getByRole('button', { name: 'Erneut verknüpfen …' }).click();
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expect(drawer).toContainText('/Users/demo/Material/Referenz Nachtfahrt.jpg');
  await expect(logo).not.toContainText('Datei fehlt');
  expect(errors).toEqual([]);
});
