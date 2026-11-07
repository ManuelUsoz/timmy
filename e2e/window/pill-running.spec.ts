import { expect, test } from '../fixtures';

test.describe('the Pill shows the running Terminals', () => {
  test.use({ language: 'en' });

  test('counts them as they open and close, and goes idle when none is left', async ({ timmy }) => {
    const { page } = timmy;
    const pill = page.locator('ui-pill');
    const terminals = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' });
    const closePane = async () => {
      await page.locator('app-pane-stack').getByRole('button', { name: 'Close pane' }).click();
      await page.getByRole('dialog', { name: 'Close the pane?' }).getByRole('button', { name: 'Close', exact: true }).click();
    };

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

    // Closing the open Terminal's Pane closes it (a live shell is Working, so it asks); the other one is still running.
    await timmy.switchMode('Expanded');
    await closePane();
    await expect(terminals.getByRole('option')).toHaveCount(1);
    await timmy.switchMode('Pill');
    await expect(pill).toContainText('1 terminal running');

    await timmy.switchMode('Expanded');
    await terminals.getByRole('option').click();
    await closePane();
    await expect(terminals.getByRole('option')).toHaveCount(0);
    await timmy.switchMode('Pill');
    await expect(pill).toContainText('Nothing running');
    await timmy.shot('pill-after-closing');
  });

  test('does not count a Terminal whose process exited as running', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.run('Start-Sleep -Seconds 3; exit 0');
    await timmy.switchMode('Pill');
    await expect(page.locator('ui-pill')).toContainText('1 terminal done');
  });
});
