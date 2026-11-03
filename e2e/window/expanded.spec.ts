import { expect, test } from '../fixtures';

test('Expanded is the resizable Workspace window, with the rail and the Projects screen', async ({ timmy }) => {
  const { page } = timmy;
  const control = (name: string) => page.getByRole('button', { name, exact: true });
  // The project row shows the temp folder of the run, which changes between runs.
  const volatile = [page.locator('.as-row__sub')];

  await timmy.openPanel();
  await timmy.switchMode('Expanded');

  await test.step('window opens at 1280x800 or 90 % of the work area', async () => {
    const b = await timmy.bounds();
    expect(b.width).toBeGreaterThanOrEqual(800);
    expect(b.width).toBeLessThanOrEqual(1280 + 8);
    expect(b.height).toBeLessThanOrEqual(800 + 8);
  });

  await test.step('workspace is showing in Spanish', async () => {
    await timmy.text('Proyectos');
  });

  await test.step('has our own Minimizar, Maximizar and Cerrar controls', async () => {
    for (const name of ['Minimizar', 'Maximizar', 'Cerrar']) await control(name).waitFor({ timeout: 3000 });
  });
  // Rail on the left with Proyectos and Ajustes; Projects column and its content; custom Carbon-style minimize, maximize and close at the top right, and no native Windows buttons.
  await timmy.shot('expanded-workspace', { mask: volatile });

  await test.step('Maximizar maximizes the window and the control becomes Restaurar', async () => {
    await control('Maximizar').click();
    await control('Restaurar').waitFor({ timeout: 3000 });
    expect(await timmy.isMaximized()).toBe(true);
  });
  // Workspace filling the work area; the middle control shows the restore icon (two overlapping squares).
  await timmy.shot('expanded-maximized', { mask: volatile });

  await test.step('Restaurar restores the window', async () => {
    await control('Restaurar').click();
    await control('Maximizar').waitFor({ timeout: 3000 });
    expect(await timmy.isMaximized()).toBe(false);
  });

  await test.step('leaving Expanded shows no minimize or maximize in the Panel', async () => {
    await timmy.switchMode('Panel');
    await expect(control('Minimizar')).toHaveCount(0);
  });
  // Panel with only its own header: switcher and close, no minimize or maximize.
  await timmy.shot('expanded-panel-after');
});
