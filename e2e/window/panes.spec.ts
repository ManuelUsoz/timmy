import { expect, test } from '../fixtures';

test.describe('Panes and Stacks inside a Tab', () => {
  test.use({ language: 'en' });

  test('splits, stacks, moves Views with the keyboard and closes Panes', async ({ timmy }) => {
    const { page } = timmy;
    const panes = page.locator('app-pane-stack');
    const focused = page.locator('app-pane-stack.focused');
    const expandedName = focused.locator('.view-header.act .name');
    // The prompts show the run's temporary folder, which changes every run.
    const prompt = [page.locator('.xterm-screen')];

    await timmy.addDemoProject();
    await page.keyboard.press('Control+t');
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
    await expect(panes).toHaveCount(1);

    await test.step('Split right and Split down each put a new Terminal in a new, focused Pane', async () => {
      await focused.getByRole('button', { name: 'Split right' }).click();
      await expect(panes).toHaveCount(2);
      await expect(expandedName).toHaveText('Terminal 2');
      await focused.getByRole('button', { name: 'Split down' }).click();
      await expect(panes).toHaveCount(3);
      await expect(expandedName).toHaveText('Terminal 3');
      await expect(page.getByRole('separator', { name: 'Resize panes' })).toHaveCount(2);
      await expect(page.locator('.xterm-screen')).toHaveCount(3);
      await timmy.shot('panes-split', { mask: prompt });
    });

    await test.step('Add to stack holds up to 3 Views, then is disabled', async () => {
      const add = focused.getByRole('button', { name: 'Add to stack' });
      await add.click();
      await add.click();
      await expect(focused.locator('.view-header')).toHaveCount(3);
      await expect(add).toBeDisabled();
      await expect(expandedName).toHaveText('Terminal 5');
      await timmy.shot('panes-stack-full', { mask: prompt });
    });

    await test.step('Alt+1–3 shows a View; Alt+Shift+↑ moves it one place', async () => {
      await page.keyboard.press('Alt+1');
      await expect(expandedName).toHaveText('Terminal 3');
      await page.keyboard.press('Alt+Shift+ArrowDown');
      await expect(focused.locator('.view-header .name')).toHaveText(['Terminal 4', 'Terminal 3', 'Terminal 5']);
    });

    await test.step('the header menu lists the actions with their keys, and Open diff and Open PR as Soon', async () => {
      await focused.getByRole('button', { name: 'More actions' }).click();
      const menu = page.getByRole('menu', { name: 'More actions' });
      await expect(menu.getByRole('menuitem', { name: /Open diff/ })).toBeDisabled();
      await expect(menu.getByRole('menuitem', { name: /Open PR/ })).toBeDisabled();
      await expect(menu).toContainText('Soon');
      await timmy.shot('panes-stack-menu', { mask: prompt });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    });

    await test.step('Alt+Shift+Enter moves the View out of the Stack into a new Pane', async () => {
      await page.keyboard.press('Alt+Shift+Enter');
      await expect(panes).toHaveCount(4);
      await expect(focused.locator('.view-header')).toHaveCount(1);
      await expect(expandedName).toHaveText('Terminal 3');
    });

    await test.step('closing a Pane with a live shell asks first, then closes its Terminals', async () => {
      await focused.getByRole('button', { name: 'Close pane' }).click();
      const confirm = page.getByRole('dialog', { name: 'Close the pane?' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(panes).toHaveCount(3);
      await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option')).toHaveCount(4);
    });
  });
});
