import { expect, test } from '../fixtures';

test.describe('Settings', () => {
  test.use({ language: 'en' });

  test('lists the Providers, enables one, and offers the language', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openPanel();
    await timmy.switchMode('Expanded');
    await page.getByRole('link', { name: 'Settings' }).click();

    const settings = page.locator('app-settings-screen');
    const rows = settings.getByTestId('provider-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('OpenCode');
    await expect(rows.nth(1)).toContainText('Claude Code');
    await expect(rows.nth(2)).toContainText('Codex');
    await expect(settings.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible();
    await timmy.shot('settings-providers');

    await settings.getByRole('button', { name: 'Enable Claude Code' }).click();
    await expect(settings.getByRole('button', { name: 'Disable Claude Code' })).toBeVisible();
    await expect(rows.nth(1)).toContainText('Enabled');
    await expect(rows.nth(0)).toContainText('Disabled');
    await timmy.shot('settings-provider-enabled');

    await settings.getByRole('button', { name: 'Language' }).click();
    await expect(settings.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    await timmy.shot('settings-language');
  });
});
