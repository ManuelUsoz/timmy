import { expect, test } from '../fixtures';

test.describe('Revealing a Terminal', () => {
  test.use({ language: 'en' });

  test('Panel to Expanded and the sidebar take the user to the Terminal: its Pane focused, its View expanded in the Stack', async ({ timmy }) => {
    const { page } = timmy;
    const focused = page.locator('app-pane-stack.focused');
    const expandedName = focused.locator('.view-header.act .name');
    const sidebarRow = (name: string) =>
      page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option').filter({ hasText: name });
    const panel = page.getByRole('region', { name: 'Timmy panel' });
    // The prompts show the run's temporary folder, which changes every run.
    const prompt = [page.locator('.xterm-screen')];

    await timmy.addDemoProject();
    await page.keyboard.press('Control+t');
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });

    await test.step('Terminals 1 and 2 share a Stack, and Terminal 3 has a Pane of its own, focused', async () => {
      await focused.getByRole('button', { name: 'Add to stack' }).click();
      await expect(expandedName).toHaveText('Terminal 2');
      await focused.getByRole('button', { name: 'Split right' }).click();
      await expect(page.locator('app-pane-stack')).toHaveCount(2);
      await expect(expandedName).toHaveText('Terminal 3');
    });

    await test.step('Panel to Expanded reveals the Panel\'s Terminal: the Stack expands it and its Pane is focused', async () => {
      await timmy.switchMode('Panel');
      await panel.getByRole('listbox', { name: 'Terminals' }).getByRole('option').filter({ hasText: 'Terminal 1' }).click();
      await timmy.switchMode('Expanded');
      await expect(expandedName).toHaveText('Terminal 1');
      await expect(focused.locator('.view-header')).toHaveCount(2);
      await timmy.shot('reveal-from-panel', { mask: prompt });
    });

    await test.step('a sidebar Terminal collapsed in a Stack is expanded there', async () => {
      await sidebarRow('Terminal 3').click();
      await expect(expandedName).toHaveText('Terminal 3');
      await expect(focused.locator('.view-header')).toHaveCount(1);

      await sidebarRow('Terminal 2').click();
      await expect(expandedName).toHaveText('Terminal 2');
      await expect(focused.locator('.view-header')).toHaveCount(2);
      await timmy.shot('reveal-from-sidebar', { mask: prompt });
    });
  });
});
