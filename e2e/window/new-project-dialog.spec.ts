import { expect, test } from '../fixtures';

test('New project opens in the shared modal and Cancelar closes it', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.switchMode('Expanded');
  await page.getByRole('button', { name: 'Nuevo proyecto' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Nuevo proyecto' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Examinar' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Crear proyecto' })).toBeDisabled();
  // look: shared modal, INFO state word over "Nuevo proyecto", folder field with Examinar, Cancelar left and a disabled Crear proyecto right.
  await timmy.shot('new-project-dialog-idle', { mask: [page.locator('.as-row__sub')] });

  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
});
