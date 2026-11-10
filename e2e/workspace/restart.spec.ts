import { expect, STAND_IN_OUTPUT, test } from '../fixtures';

test.describe('The layout across restarts', () => {
  test.use({ language: 'en', providers: ['ClaudeCode'] });

  test('comes back as it was, with Idle Terminals that start on demand', async ({ timmy }) => {
    // A restart gives Timmy a new window, so everything is looked up on the page as it is now.
    const page = () => timmy.page;
    const bar = () => page().getByRole('navigation', { name: 'Tabs of demo-project' });
    const tab = (name: string) => bar().locator('.tab-button', { hasText: name });
    const panes = () => page().locator('app-pane-stack');
    const sidebarTerminals = () => page().getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option');
    const reopen = async () => {
      // Saving waits a moment for changes to settle.
      await page().waitForTimeout(600);
      await timmy.restart();
      await timmy.switchMode('Expanded');
      await page().locator('app-project-list .as-row__title', { hasText: 'demo-project' }).click();
    };

    await test.step('build a layout: Claude Code in a Tab split with a shell, and a second, renamed Tab', async () => {
      await timmy.addDemoProject();
      await bar().getByRole('button', { name: 'New tab' }).click();
      await page().getByRole('listbox', { name: 'New tab' }).getByRole('option', { name: 'Claude Code' }).click();
      await expect(page().locator('.xterm-screen')).toContainText(STAND_IN_OUTPUT, { timeout: 15_000 });
      await page().locator('app-pane-stack.focused').getByRole('button', { name: 'Split right' }).click();
      await page().getByRole('listbox', { name: 'Split right' }).getByRole('option', { name: 'Shell' }).click();
      await expect(panes()).toHaveCount(2);
      await expect(page().locator('.xterm-screen')).toHaveCount(2);

      await bar().getByRole('button', { name: 'New tab' }).click();
      await page().getByRole('listbox', { name: 'New tab' }).getByRole('option', { name: 'Shell' }).click();
      await expect(page().locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
      await tab('shell 3').dblclick();
      const field = bar().getByRole('textbox', { name: 'Tab name' });
      await field.fill('scratch');
      await field.press('Enter');
      await expect(tab('scratch')).toBeVisible();
      await expect(sidebarTerminals()).toHaveCount(3);
    });

    await test.step('after a restart the Tabs, Panes and Terminals are back, none of them started', async () => {
      await reopen();
      await expect(bar().locator('.tab-button .name')).toHaveText(['claude 1', 'scratch']);
      await expect(sidebarTerminals()).toHaveCount(3);
      await tab('claude 1').click();
      await expect(panes()).toHaveCount(2);
      await expect(page().locator('app-terminal-screen .start')).toHaveCount(2);
      await expect(page().locator('app-pane-stack .view-header [data-activity]')).toHaveCount(0);
      await timmy.shot('restart-restored-idle');
    });

    await test.step('starting a Terminal runs its Provider in the Project folder, and only that one', async () => {
      const first = panes().nth(0);
      await first.getByRole('button', { name: 'Start' }).click();
      await expect(first.locator('.xterm-screen')).toContainText(STAND_IN_OUTPUT, { timeout: 15_000 });
      await expect(first.locator('.start')).toHaveCount(0);
      // The other Pane's Terminal is still not started.
      await expect(panes().nth(1).locator('.start')).toHaveCount(1);

      await panes().nth(1).getByRole('button', { name: 'Start' }).click();
      await expect(panes().nth(1).locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
      await expect(panes().nth(1).locator('.xterm-screen')).not.toContainText(STAND_IN_OUTPUT);
    });

    await test.step('closing a Tab removes its Terminals from the store: they do not come back', async () => {
      await bar().getByRole('button', { name: 'Close tab scratch' }).click();
      // Its Terminal was never started, so closing the Tab asks nothing.
      await expect(tab('scratch')).toHaveCount(0);
      await reopen();
      await expect(bar().locator('.tab-button .name')).toHaveText(['claude 1']);
      await expect(sidebarTerminals()).toHaveCount(2);
    });
  });
});
