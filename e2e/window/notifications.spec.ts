import { expect, test } from '../fixtures';

test.describe('Notifications: the toast Channel', () => {
  test.use({ language: 'en' });

  test('Settings lists the toast Channel, and a Terminal that fails off screen shows a toast until the Channel is off', async ({ timmy }) => {
    const { page } = timmy;
    const toasts = page.getByRole('region', { name: 'Notifications' });
    await timmy.openProjectTerminal();
    // It fails a few seconds from now, once the user has left it for Settings.
    await timmy.run('Start-Sleep -Seconds 4; exit 1');
    await page.getByRole('link', { name: 'Settings' }).click();

    const settings = page.locator('app-settings-screen');
    await settings.getByRole('button', { name: 'Notifications' }).click();
    const row = settings.getByTestId('channel-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('In-app toasts');
    const toggle = settings.getByRole('switch', { name: 'Notify with In-app toasts' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    for (const type of ['Waiting', 'Done', 'Error']) await expect(row.getByRole('button', { name: type })).toHaveAttribute('aria-pressed', 'true');
    await expect(toasts).toBeEmpty();
    await timmy.shot('notifications-settings');

    await expect(toasts).toContainText('Terminal 1 in demo-project failed.', { timeout: 10_000 });
    await timmy.shot('notifications-toast-error');

    // Switched off, the Channel stays silent about the next failure.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('link', { name: 'Projects' }).click();
    await timmy.newTerminal();
    await timmy.run('Start-Sleep -Seconds 2; exit 1');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(toasts).not.toContainText('Terminal 2', { timeout: 1_000 });
    await page.waitForTimeout(4_000);
    await expect(toasts).not.toContainText('Terminal 2');
  });

  test('a Terminal that fails while it is on screen shows no toast', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.run('exit 1');
    // The process has ended once its Stop button is gone.
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeEmpty();
  });
});
