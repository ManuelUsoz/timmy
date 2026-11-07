import { expect, test } from '../fixtures';

test.use({ language: 'en' });

test('the sidebar lists every Terminal, opens one, and collapses to 48 px with Ctrl+B', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openProjectTerminal();
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  // A Terminal's status follows its output, so the status words and the Project's count dot are masked.
  const volatile = [sidebar.locator('ui-state'), sidebar.locator('.dot')];

  await test.step('the Terminal is listed under its Project, and the Project counts it', async () => {
    const terminals = sidebar.getByRole('listbox', { name: 'Terminals' });
    await expect(terminals.getByRole('group', { name: 'demo-project' }).getByRole('option')).toHaveText([/Terminal 1/]);
    await expect(terminals.getByRole('option', { name: /Terminal 1/ })).toHaveAttribute('aria-current', 'true');
    await expect(sidebar.getByRole('listbox', { name: 'Projects' }).getByRole('option', { name: /demo-project/ }).locator('.count')).toHaveText('1');
  });
  // Sidebar: demo-project with one Terminal; Terminals with Terminal 1 open; Settings with Ctrl , at the foot.
  await timmy.shot('sidebar-terminal', { mask: volatile });

  await test.step('Ctrl+B collapses the sidebar to 48 px, even from the Terminal', async () => {
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+b');
    await expect(sidebar).toHaveClass(/collapsed/);
    expect((await sidebar.boundingBox())!.width).toBe(48);
  });
  // Collapsed strip: expand button, the project's avatar, new project, Terminals and Settings.
  await timmy.shot('sidebar-collapsed', { mask: volatile });

  await test.step('Ctrl+B expands it again', async () => {
    await page.keyboard.press('Control+b');
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  const settingsButton = sidebar.getByRole('button', { name: 'Settings', exact: true });
  const settings = page.getByRole('dialog', { name: 'Settings' });

  await test.step('Ctrl+, opens the Settings dialog', async () => {
    await page.keyboard.press('Control+,');
    await expect(settings).toBeVisible();
    await expect(settingsButton).toHaveAttribute('aria-expanded', 'true');
  });

  await test.step('Ctrl+, again closes it', async () => {
    await page.keyboard.press('Control+,');
    await expect(settings).toBeHidden();
    await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
  });
});

test('a right click on a Project offers to remove it, which closes its Terminals', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openProjectTerminal();
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  const projects = sidebar.getByRole('listbox', { name: 'Projects' });
  const menu = page.getByRole('menu', { name: 'demo-project options' });

  await test.step('the menu opens at the pointer and Esc closes it', async () => {
    await projects.getByRole('option', { name: /demo-project/ }).click({ button: 'right' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Remove project']);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  await test.step('Remove project takes it out of the list and closes its Terminal', async () => {
    await projects.getByRole('option', { name: /demo-project/ }).click({ button: 'right' });
    await expect(menu).toBeVisible();
    // The project's menu over the sidebar: Remove project, in the error colour.
    await timmy.shot('sidebar-project-menu', { mask: [sidebar.locator('ui-state'), sidebar.locator('.dot')] });
    // A fresh Terminal may be Working while its shell starts; confirm if asked.
    await menu.getByRole('menuitem', { name: 'Remove project' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove demo-project?' });
    const removed = expect(projects.getByRole('option')).toHaveCount(0);
    await Promise.race([removed, confirm.waitFor()]);
    if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Remove project' }).click();
    await removed;
    await expect(sidebar.getByRole('listbox', { name: 'Terminals' }).getByRole('option')).toHaveCount(0);
  });
});
