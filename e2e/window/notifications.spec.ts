import { expect, test } from '../fixtures';

test.describe('Notifications: the toast Channel', () => {
  test.use({ language: 'en' });

  test('Settings lists the toast Channel, and a Terminal that fails off screen shows a toast until the Channel is off', async ({ timmy }) => {
    const { page } = timmy;
    const toasts = page.getByRole('region', { name: 'Notifications' });
    const settingsButton = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Settings', exact: true });
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const project = page.getByRole('listbox', { name: 'Projects' }).getByRole('option', { name: /demo-project/ });
    await timmy.openProjectTerminal();
    // It fails a few seconds from now, once the user has left it.
    await timmy.run('Start-Sleep -Seconds 4; exit 1');
    // Settings is a dialog over the Workspace and would leave the Terminal mounted (still on screen) underneath, so
    // first leave the Terminal for its Project: the Terminal screen goes away and the Terminal is off screen.
    await project.click();
    await expect(page.locator('app-terminal-screen')).toHaveCount(0);
    await settingsButton.click();

    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Notifications' }).click();
    const row = settings.getByTestId('channel-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('In-app toasts');
    const toggle = settings.getByRole('switch', { name: 'Notify with In-app toasts' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    for (const type of ['Waiting', 'Done', 'Error']) await expect(row.getByRole('button', { name: type })).toHaveAttribute('aria-pressed', 'true');
    await expect(toasts).toBeEmpty();
    await timmy.shot('notifications-settings');

    await expect(toasts).toContainText('shell 1 in demo-project failed.', { timeout: 10_000 });
    await timmy.shot('notifications-toast-error');

    // Switched off, the Channel stays silent about the next failure.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await timmy.newTerminal();
    await timmy.run('Start-Sleep -Seconds 2; exit 1');
    // Off screen again, as above, so only the Channel being off keeps the toast away.
    await project.click();
    await expect(page.locator('app-terminal-screen')).toHaveCount(0);
    await settingsButton.click();
    await expect(settings).toBeVisible();
    await expect(toasts).not.toContainText('shell 2', { timeout: 1_000 });
    await page.waitForTimeout(4_000);
    await expect(toasts).not.toContainText('shell 2');
  });

  test('a Terminal that fails while it is on screen shows no toast', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.run('exit 1');
    // The process has ended once the screen says how.
    await expect(page.locator('app-terminal-screen').getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeEmpty();
  });
});
