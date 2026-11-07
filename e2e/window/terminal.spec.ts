import { expect, test } from '../fixtures';

type Fixture = Parameters<Parameters<typeof test>[2]>[0]['timmy'];

const openNewTerminal = async (timmy: Fixture): Promise<void> => {
    await timmy.openPanel();
    await timmy.switchMode('Expanded');
    await timmy.page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = timmy.page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('button', { name: 'Browse' }).click();
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(timmy.page.locator('app-project-list .as-row__title')).toContainText('demo-project', { timeout: 10_000 });

    await timmy.page.getByRole('navigation', { name: /^Tabs of / }).getByRole('button', { name: 'New tab' }).click();
};

test.describe('real terminals', () => {
  test.use({ language: 'en' });

  test('opens a project terminal, renders output, and keeps it when switching', async ({ timmy }) => {
    await openNewTerminal(timmy);
    await expect(timmy.page.locator('app-terminal-screen')).toBeVisible();
    await expect(timmy.page.locator('.xterm')).toBeVisible();
    const fill = await timmy.page.evaluate(() => {
      const pane = document.querySelector('app-terminal-screen .output')!.getBoundingClientRect();
      const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect();
      return { paneHeight: pane.height, screenHeight: screen.height, paneWidth: pane.width, screenWidth: screen.width };
    });
    expect(fill.screenHeight).toBeGreaterThan(fill.paneHeight * 0.9);
    expect(fill.screenWidth).toBeGreaterThan(fill.paneWidth * 0.9);
    await timmy.shot('terminal-open');

    await timmy.page.locator('.xterm-helper-textarea').focus();
    await timmy.page.keyboard.type('echo timmy-terminal');
    await timmy.page.keyboard.press('Enter');
    await expect(timmy.page.locator('.xterm-screen')).toContainText('timmy-terminal');
    await timmy.shot('terminal-output');

    await timmy.page.getByRole('navigation', { name: /^Tabs of / }).getByRole('button', { name: 'New tab' }).click();
    await expect(timmy.page.locator('app-terminal-screen')).toHaveCount(1);
    await timmy.page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option', { name: /Terminal 1/ }).click();
    await expect(timmy.page.locator('.xterm-screen')).toContainText('timmy-terminal');
    await timmy.shot('terminal-switched');
  });

  test('shows the Error state with the exit code, and restarts into a live terminal', async ({ timmy }) => {
    await openNewTerminal(timmy);
    await expect(timmy.page.locator('.xterm-screen')).toContainText('PS ');
    await timmy.page.locator('.xterm-helper-textarea').focus();
    await timmy.page.keyboard.type('exit 3');
    await timmy.page.keyboard.press('Enter');
    const screen = timmy.page.locator('app-terminal-screen');
    await expect(screen.getByRole('alert')).toContainText('The process exited with code 3.');
    // In a Pane, Restart and Close are in the header menu.
    const pane = timmy.page.locator('app-pane-stack');
    await pane.getByRole('button', { name: 'More actions' }).click();
    await expect(pane.getByRole('menuitem', { name: 'Restart' })).toBeEnabled();
    await expect(pane.getByRole('menuitem', { name: 'Close pane' })).toBeEnabled();
    await timmy.shot('terminal-error');

    await pane.getByRole('menuitem', { name: 'Restart' }).click();
    await expect(screen.getByRole('alert')).toHaveCount(0);
    await expect(timmy.page.locator('.xterm-screen')).toContainText('PS ');
    await expect(timmy.page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option')).toHaveCount(1);
  });
});
