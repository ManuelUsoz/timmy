import { expect, test } from '../fixtures';

test.describe('The Switcher', () => {
  test.use({ language: 'en' });

  test('Ctrl+Tab moves between Tabs: release confirms, Esc cancels, search and number keys jump', async ({ timmy }) => {
    const { page } = timmy;
    const bar = page.getByRole('navigation', { name: 'Tabs of demo-project' });
    const active = bar.locator('.tab-button[aria-current=page] .name');
    const switcher = page.getByRole('dialog', { name: 'Switch tab or project' });
    const cards = switcher.getByRole('option');
    const selected = switcher.locator('[role=option][aria-selected=true] .names');
    const screen = page.locator('app-pane-stack.focused .xterm-screen');

    /**
     * The prompt shows the run's temporary folder, which changes every run: a short one keeps the Terminals behind the
     * Switcher, and the previews in it, the same in every run.
     */
    const stablePrompt = async () => {
      await timmy.run("function prompt { 'PS> ' }; cls");
      await expect(screen).not.toContainText('Temp', { timeout: 10_000 });
      await expect(screen).toContainText('PS>');
    };

    await timmy.addDemoProject();
    await page.keyboard.press('Control+t');
    await expect(screen).toContainText('PS ', { timeout: 15_000 });
    await expect(active).toHaveText('Terminal 1');
    await stablePrompt();
    await timmy.run('echo switcher-preview');
    await expect(screen).toContainText(/switcher-preview\s*switcher-preview\s*PS>/);

    await timmy.newTerminal();
    await expect(active).toHaveText('Terminal 2');
    await stablePrompt();
    await bar.locator('.tab-button', { hasText: 'Terminal 2' }).dblclick();
    const field = bar.getByRole('textbox', { name: 'Tab name' });
    await field.fill('review');
    await field.press('Enter');
    await expect(active).toHaveText('review');

    await timmy.newTerminal();
    await expect(active).toHaveText('Terminal 3');
    await stablePrompt();

    await test.step('held Ctrl+Tab opens on the previous Tab, Tab moves on, releasing Ctrl goes there', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('Tab');
      await expect(switcher).toBeVisible();
      // Most recent first: the Tab on screen, then the one before it.
      await expect(cards.locator('.names')).toHaveText(['demo-project · Terminal 3', 'demo-project · review', 'demo-project · Terminal 1']);
      await expect(cards.locator('kbd')).toHaveText(['1', '2', '3']);
      await expect(selected).toHaveText('demo-project · review');
      await expect(cards.nth(2).locator('.preview .line')).toContainText(['switcher-preview']);
      await timmy.shot('switcher-open');

      await page.keyboard.press('Tab');
      await expect(selected).toHaveText('demo-project · Terminal 1');
      await page.keyboard.press('Shift+Tab');
      await expect(selected).toHaveText('demo-project · review');
      await page.keyboard.press('Tab');
      await expect(selected).toHaveText('demo-project · Terminal 1');
      await page.keyboard.up('Control');
      await expect(switcher).toHaveCount(0);
      await expect(active).toHaveText('Terminal 1');
      await expect(screen).toContainText('switcher-preview');
    });

    await test.step('Esc cancels and stays on the same Tab', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('Tab');
      await expect(switcher).toBeVisible();
      await expect(selected).toHaveText('demo-project · Terminal 3');
      await page.keyboard.press('Escape');
      await expect(switcher).toHaveCount(0);
      await page.keyboard.up('Control');
      await expect(switcher).toHaveCount(0);
      await expect(active).toHaveText('Terminal 1');
    });

    await test.step('a click inside keeps it open for the search; Enter goes to the match', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('Tab');
      await expect(switcher).toBeVisible();
      const search = page.locator('app-switcher input[type=search]');
      await search.click();
      await page.keyboard.up('Control');
      await expect(switcher).toBeVisible();
      await expect(search).toBeFocused();
      await page.keyboard.type('rev');
      await expect(cards.locator('.names')).toHaveText(['demo-project · review']);
      await expect(selected).toHaveText('demo-project · review');
      await timmy.shot('switcher-search');
      await page.keyboard.press('Enter');
      await expect(switcher).toHaveCount(0);
      await expect(active).toHaveText('review');
    });

    await test.step('a number key goes straight to its card', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('Tab');
      await expect(switcher).toBeVisible();
      // review (on screen), Terminal 1, Terminal 3.
      await expect(cards.locator('.names')).toHaveText(['demo-project · review', 'demo-project · Terminal 1', 'demo-project · Terminal 3']);
      await page.keyboard.press('3');
      await expect(switcher).toHaveCount(0);
      await page.keyboard.up('Control');
      await expect(active).toHaveText('Terminal 3');
    });
  });
});
