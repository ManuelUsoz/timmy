import { expect, test } from '../fixtures';

test.describe('Tabs per Project', () => {
  test.use({ language: 'en' });

  test('opens, switches, renames and closes Tabs', async ({ timmy }) => {
    const { page } = timmy;
    const bar = page.getByRole('navigation', { name: 'Tabs of demo-project' });
    const tab = (name: string) => bar.locator('.tab-button', { hasText: name });
    const active = bar.locator('.tab-button[aria-current=page] .name');
    // The prompt shows the run's temporary folder, which changes every run.
    const prompt = [page.locator('.xterm-screen')];

    await timmy.addDemoProject();
    // A Project with no Tabs shows the bar, with its tools and no Tabs, and the New Tab action.
    await expect(bar).toBeVisible();
    await expect(bar.locator('.tab-button')).toHaveCount(0);
    await expect(bar.locator('.tool')).toHaveCount(5);
    await expect(page.locator('.no-tabs').getByRole('button')).toHaveText(/New tab\s*CtrlT/);
    await timmy.shot('tabs-empty');

    // Ctrl+T opens a Tab; with no Provider enabled the picker goes straight to a shell.
    await page.keyboard.press('Control+t');
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
    await expect(active).toHaveText('Terminal 1');
    await timmy.shot('tabs-one', { mask: prompt });

    await bar.getByRole('button', { name: 'New tab' }).click();
    await expect(active).toHaveText('Terminal 2');
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });

    await page.keyboard.press('Control+1');
    await expect(active).toHaveText('Terminal 1');

    await tab('Terminal 1').dblclick();
    const field = bar.getByRole('textbox', { name: 'Tab name' });
    await field.fill('review');
    await field.press('Enter');
    await expect(active).toHaveText('review');
    await timmy.shot('tabs-renamed', { mask: prompt });

    await bar.getByRole('button', { name: 'Agents' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Agents · Soon');
    await timmy.shot('tabs-soon', { mask: prompt });

    // A live shell is Working, so closing its Tab asks first.
    await bar.getByRole('button', { name: 'Close tab review' }).click();
    const confirm = page.getByRole('dialog', { name: 'Close the tab review?' });
    await expect(confirm).toBeVisible();
    // No mask: it would cover the dialog, and the backdrop already blurs the prompt behind it.
    await timmy.shot('tabs-confirm-close');
    await confirm.getByRole('button', { name: 'Close tab' }).click();
    await expect(bar.locator('.tab-button .name')).toHaveText(['Terminal 2']);
    await expect(active).toHaveText('Terminal 2');

    // A Tab whose Terminal is Done closes at once, and the Project is back to the New Tab action.
    await timmy.run('exit 0');
    await expect(page.locator('app-terminal-screen')).toContainText('No active process', { timeout: 15_000 });
    await bar.getByRole('button', { name: 'Close tab Terminal 2' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(bar.locator('.tab-button')).toHaveCount(0);
    await expect(page.locator('.no-tabs').getByRole('button', { name: 'New tab' })).toBeVisible();
  });
});
