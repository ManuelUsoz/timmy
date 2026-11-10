import { expect, test } from '../fixtures';

test.describe('the Panel shows the current Terminal', () => {
  test.use({ language: 'en' });

  test('opens at 880x560 with an empty state that sends the user to the Workspace when there is no Project', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openPanel();

    await test.step('panel is 880x560', async () => {
      const b = await timmy.bounds();
      expect(Math.abs(b.width - 880)).toBeLessThanOrEqual(8);
      expect(Math.abs(b.height - 560)).toBeLessThanOrEqual(8);
    });

    const panel = page.getByRole('region', { name: 'Timmy panel' });
    await expect(panel.getByRole('heading', { name: 'No terminals yet' })).toBeVisible();
    await expect(panel).toContainText('Add a project in the Workspace');
    await timmy.shot('panel-empty-no-project');

    await panel.getByRole('button', { name: 'Open Workspace' }).click();
    await expect(page.locator('app-workspace')).toBeVisible();
  });

  test('offers to open a Terminal in the last Project, and renders it live with the same output as the Workspace', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.addDemoProject();
    await timmy.switchMode('Panel');
    const panel = page.getByRole('region', { name: 'Timmy panel' });
    await expect(panel.getByRole('heading', { name: 'No terminals yet' })).toBeVisible();
    await expect(panel).toContainText('It opens in demo-project.');
    await timmy.shot('panel-empty');

    await panel.getByRole('button', { name: 'New terminal' }).click();
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
    await expect(panel.getByRole('listbox', { name: 'Terminals' }).locator('.as-row__title')).toHaveText(['shell 1']);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('echo from-the-panel');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-screen')).toContainText('from-the-panel');
    // The volatile parts are the temp folder of the Project: its path in the header and in the prompt.
    await timmy.shot('panel-terminal', { mask: [page.locator('app-terminal-screen .cwd'), page.locator('.xterm-screen')] });

    await timmy.switchMode('Expanded');
    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option', { name: /shell 1/ }).click();
    await expect(page.locator('app-workspace .xterm-screen')).toContainText('from-the-panel');
  });

  test('switches between the Terminals that are running', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.newTerminal();
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('echo only-in-two');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-screen')).toContainText('only-in-two');

    await timmy.switchMode('Panel');
    const panel = page.getByRole('region', { name: 'Timmy panel' });
    const rail = panel.getByRole('listbox', { name: 'Terminals' });
    await expect(rail.locator('.as-row__title')).toHaveText(['shell 1', 'shell 2']);
    await expect(panel.getByRole('heading', { name: 'shell 2' })).toBeVisible();
    await expect(page.locator('.xterm-screen')).toContainText('only-in-two');

    await rail.getByRole('option', { name: /shell 1/ }).click();
    await expect(panel.getByRole('heading', { name: 'shell 1' })).toBeVisible();
    // shell 1 was recorded in the Workspace (wide) and is shown here (narrow): its screen is restored whole, not cut at the start.
    await expect(page.locator('.xterm-screen')).toContainText(/PS C:\\Users.*demo-project>/);
    await expect(page.locator('.xterm-screen')).not.toContainText('only-in-two');
    await timmy.shot('panel-switched', { mask: [page.locator('app-terminal-screen .cwd'), page.locator('.xterm-screen')] });

    // And back in the Workspace (wide again), it still shows its whole prompt; so does the one that never changed size.
    await timmy.switchMode('Expanded');
    const terminals = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' });
    await expect(page.locator('app-workspace .xterm-screen')).toContainText(/PS C:\\Users.*demo-project>/);
    await terminals.getByRole('option', { name: /shell 2/ }).click();
    await expect(page.locator('app-workspace .xterm-screen')).toContainText('only-in-two');
    await terminals.getByRole('option', { name: /shell 1/ }).click();
    await expect(page.locator('app-workspace .xterm-screen')).toContainText(/PS C:\\Users.*demo-project>/);
    await timmy.switchMode('Panel');
    await expect(panel.getByRole('heading', { name: 'shell 1' })).toBeVisible();

    // Stopping the open one leaves the other as the current Terminal; stopping that one brings the empty state back.
    await panel.getByRole('button', { name: 'Stop' }).click();
    await expect(panel.getByRole('heading', { name: 'shell 2' })).toBeVisible();
    await panel.getByRole('button', { name: 'Stop' }).click();
    await expect(panel.getByRole('heading', { name: 'No terminals yet' })).toBeVisible();
  });
});
