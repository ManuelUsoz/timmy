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

  await test.step('Ctrl+, opens Settings', async () => {
    await page.keyboard.press('Control+,');
    await expect(page.locator('app-settings-screen')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });
});
