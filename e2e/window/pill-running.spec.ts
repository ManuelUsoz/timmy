import { expect, test } from '../fixtures';

test.describe('the Pill shows the running Terminals', () => {
  test.use({ language: 'en' });

  test('counts them as they open and close, and goes idle when none is left', async ({ timmy }) => {
    const { page } = timmy;
    const pill = page.locator('ui-pill');
    const terminals = page.getByRole('region', { name: 'Terminals' });

    await timmy.openProjectTerminal();
    await timmy.switchMode('Pill');
    await expect(pill).toContainText('1 terminal running');
    // Pill with the running tone, the pulse and the count.
    await timmy.shot('pill-one-terminal');

    await timmy.switchMode('Expanded');
    await timmy.newTerminal();
    await timmy.switchMode('Pill');
    await expect(pill).toContainText('2 terminals running');
    await timmy.shot('pill-two-terminals');

    // Stopping the open Terminal closes it; the other one is still running.
    await timmy.switchMode('Expanded');
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(terminals.getByRole('option')).toHaveCount(1);
    await timmy.switchMode('Pill');
    await expect(pill).toContainText('1 terminal running');

    await timmy.switchMode('Expanded');
    await terminals.getByRole('option').click();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(terminals.getByRole('option')).toHaveCount(0);
    await timmy.switchMode('Pill');
    await expect(pill).toContainText('Nothing running');
    await timmy.shot('pill-after-closing');
  });

  test('stops counting a Terminal whose process exited', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('exit 0');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Close terminal' })).toBeEnabled();
    await timmy.switchMode('Pill');
    await expect(page.locator('ui-pill')).toContainText('Nothing running');
  });
});
