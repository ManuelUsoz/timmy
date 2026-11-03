import { expect, test } from '../fixtures';

test.describe('real terminals', () => {
  test.use({ language: 'en' });

  test('opens a project terminal, renders output, and keeps it when switching', async ({ timmy }) => {
    await timmy.openPanel();
    await timmy.switchMode('Expanded');
    await timmy.page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = timmy.page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('button', { name: 'Browse' }).click();
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(timmy.page.locator('app-project-list .as-row__title')).toContainText('demo-project', { timeout: 10_000 });

    await timmy.page.getByRole('region', { name: 'Terminals' }).getByRole('button', { name: 'New terminal' }).click();
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

    await timmy.page.getByRole('region', { name: 'Terminals' }).getByRole('button', { name: 'New terminal' }).click();
    await expect(timmy.page.locator('app-terminal-screen')).toHaveCount(1);
    await timmy.page.getByRole('option', { name: /Terminal 1/ }).click();
    await expect(timmy.page.locator('.xterm-screen')).toContainText('timmy-terminal');
    await timmy.shot('terminal-switched');
  });
});
