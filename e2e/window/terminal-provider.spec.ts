import { expect, STAND_IN_OUTPUT, test } from '../fixtures';

test.describe('New terminal with a Provider picker', () => {
  test.use({ language: 'en', providers: ['ClaudeCode'] });

  test('lists the plain shell then the enabled Providers, runs the chosen CLI, and leaves a usable shell', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.addDemoProject();

    const terminals = page.getByRole('region', { name: 'Terminals' });
    await terminals.getByRole('button', { name: 'New terminal' }).click();

    const picker = page.getByRole('listbox', { name: 'New terminal' });
    const entries = picker.getByRole('option');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toHaveText('Shell');
    await expect(entries.nth(1)).toHaveText('Claude Code');
    await timmy.shot('terminal-provider-picker');

    await entries.nth(1).click();
    await expect(picker).toHaveCount(0);
    const screen = page.locator('.xterm-screen');
    await expect(screen).toContainText(STAND_IN_OUTPUT, { timeout: 15_000 });

    // The CLI exited; the shell it was typed into is still there.
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('echo shell-still-usable');
    await page.keyboard.press('Enter');
    await expect(screen).toContainText('shell-still-usable');
    await expect(page.locator('app-terminal-screen').getByRole('alert')).toHaveCount(0);
    await timmy.shot('terminal-provider-cli-exited');
  });

  test('the plain shell entry opens a terminal that runs no CLI', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.addDemoProject();

    await page.getByRole('region', { name: 'Terminals' }).getByRole('button', { name: 'New terminal' }).click();
    await page.getByRole('listbox', { name: 'New terminal' }).getByRole('option', { name: 'Shell' }).click();

    const screen = page.locator('.xterm-screen');
    await expect(screen).toContainText('PS ', { timeout: 15_000 });
    await expect(screen).not.toContainText(STAND_IN_OUTPUT);
  });

  test('the picker of the header "+" opens inside the window once a Terminal exists', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.addDemoProject();
    const terminals = page.getByRole('region', { name: 'Terminals' });
    await terminals.getByRole('button', { name: 'New terminal' }).click();
    await page.getByRole('listbox', { name: 'New terminal' }).getByRole('option', { name: 'Shell' }).click();
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });

    await terminals.getByRole('button', { name: 'New terminal' }).click();
    const picker = page.getByRole('listbox', { name: 'New terminal' });
    await expect(picker.getByRole('option')).toHaveCount(2);
    const box = await picker.boundingBox();
    expect(box!.x, 'menu is not clipped on the left').toBeGreaterThanOrEqual(0);
    await timmy.shot('terminal-provider-picker-header');
  });
});
