import { expect, STAND_IN_OUTPUT, test } from '../fixtures';

test.describe('A Terminal has a name and a #n', () => {
  test.use({ language: 'en', providers: ['ClaudeCode'] });

  test('names a Terminal after its Provider and number, renames it from its header, refuses a taken name and keeps both across a restart', async ({ timmy }) => {
    // A restart gives Timmy a new window, so everything is looked up on the page as it is now.
    const page = () => timmy.page;
    const bar = () => page().getByRole('navigation', { name: 'Tabs of demo-project' });
    const headers = () => page().locator('app-pane-stack.focused .view-header');
    const field = () => page().locator('app-terminal-name-field input');
    const sidebarRows = () => page().getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option');
    // The prompts show the run's temporary folder, which changes every run.
    const prompt = () => [page().locator('.xterm-screen')];

    await test.step('a Claude Code Terminal is "claude 1", a shell stacked on it "shell 2", each header with its #n', async () => {
      await timmy.addDemoProject();
      await bar().getByRole('button', { name: 'New tab' }).click();
      await page().getByRole('listbox', { name: 'New tab' }).getByRole('option', { name: 'Claude Code' }).click();
      await expect(page().locator('.xterm-screen')).toContainText(STAND_IN_OUTPUT, { timeout: 15_000 });
      await page().locator('app-pane-stack.focused').getByRole('button', { name: 'Add to stack' }).click();
      await page().getByRole('listbox', { name: 'Add to stack' }).getByRole('option', { name: 'Shell' }).click();
      await expect(headers().locator('.name')).toHaveText(['claude 1', 'shell 2']);
      await expect(headers().locator('.number')).toHaveText(['#1', '#2']);
      // The Tab takes its first Terminal's name.
      await expect(bar().locator('.tab-button .name')).toHaveText(['claude 1']);
    });

    await test.step('a double click on the name renames the Terminal; its #n stays', async () => {
      await page().locator('app-pane-stack.focused .view-header.act .name').dblclick();
      await field().fill('build');
      await field().press('Enter');
      await expect(headers().locator('.name')).toHaveText(['claude 1', 'build']);
      await expect(headers().locator('.number')).toHaveText(['#1', '#2']);
      await expect(sidebarRows().locator('.as-row__title')).toHaveText(['claude 1', 'build']);
      await page().mouse.move(0, 0);
      await timmy.shot('terminal-names-headers', { mask: prompt(), maskActivity: true });
    });

    await test.step('a name another Terminal of the Project has, in any case, is refused inline', async () => {
      await page().locator('app-pane-stack.focused .view-header.act .name').dblclick();
      await field().fill('CLAUDE 1');
      await field().press('Enter');
      await expect(page().locator('app-terminal-name-field [role=alert]')).toHaveText('Another terminal in this project is already called “CLAUDE 1”.');
      await field().press('Escape');
      await expect(headers().locator('.name')).toHaveText(['claude 1', 'build']);

      // From the sidebar too: F2 on a row. The message hangs below the field, clear of the masked Terminal output.
      await sidebarRows().filter({ hasText: 'build' }).press('F2');
      await field().fill('Claude 1');
      await field().press('Enter');
      await expect(page().locator('app-terminal-name-field [role=alert]')).toHaveText('Another terminal in this project is already called “Claude 1”.');
      await timmy.shot('terminal-names-taken', { mask: prompt(), maskActivity: true });
      await field().press('Escape');
      await expect(sidebarRows().locator('.as-row__title')).toHaveText(['claude 1', 'build']);
    });

    await test.step('the sidebar shows a Terminal\'s #n on hover', async () => {
      const row = sidebarRows().filter({ hasText: 'build' });
      await row.hover();
      await expect(row.locator('.as-row__hint')).toHaveText('#2');
      await expect(row.locator('.as-row__hint')).toHaveCSS('opacity', '1');
    });

    await test.step('a closed Terminal\'s number is not given again, and names and numbers survive a restart', async () => {
      await page().locator('app-pane-stack.focused').getByRole('button', { name: 'More actions' }).click();
      await page().getByRole('menu', { name: 'More actions' }).getByRole('menuitem', { name: 'Close build' }).click();
      // Its shell is running, so Timmy asks first.
      await page().getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(headers().locator('.name')).toHaveText(['claude 1']);
      await page().locator('app-pane-stack.focused').getByRole('button', { name: 'Add to stack' }).click();
      await page().getByRole('listbox', { name: 'Add to stack' }).getByRole('option', { name: 'Shell' }).click();
      await expect(headers().locator('.name')).toHaveText(['claude 1', 'shell 3']);

      // Saving waits a moment for changes to settle.
      await page().waitForTimeout(600);
      await timmy.restart();
      await timmy.switchMode('Expanded');
      await page().locator('app-project-list .as-row__title', { hasText: 'demo-project' }).click();
      await bar().locator('.tab-button', { hasText: 'claude 1' }).click();
      await expect(headers().locator('.name')).toHaveText(['claude 1', 'shell 3']);
      await expect(headers().locator('.number')).toHaveText(['#1', '#3']);
    });
  });
});
