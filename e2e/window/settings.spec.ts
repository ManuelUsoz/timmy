import { expect, test } from '../fixtures';

test.describe('Settings', () => {
  test.use({ language: 'en' });

  test('opens over the Workspace, enables a Provider, lists the shortcuts, and reopens on the last section', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.switchMode('Expanded');
    const button = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Settings', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const nav = dialog.getByRole('navigation', { name: 'Settings sections' });
    const section = (name: string | RegExp) => nav.getByRole('button', { name });

    await test.step('the sidebar button opens the dialog on General', async () => {
      await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await button.click();
      await expect(dialog).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(nav.getByRole('button')).toHaveText([
        'General',
        /^Appearance\s*Soon$/,
        'Shortcuts',
        'Agents and providers',
        'Notifications',
        /^Permissions\s*Soon$/,
        /^Terminal\s*Soon$/,
        /^Projects\s*Soon$/,
        /^Integrations\s*Soon$/,
        /^Usage and limits\s*Soon$/,
      ]);
      await expect(section('General')).toHaveAttribute('aria-current', 'page');
      await expect(dialog.getByRole('button', { name: 'Close settings (Esc)' })).toBeVisible();
      await expect(dialog).toContainText('Changes save automatically');
      const language = dialog.getByRole('radiogroup', { name: 'Language' });
      await expect(language.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
      await expect(language.getByRole('radio', { name: 'Español' })).toHaveAttribute('aria-checked', 'false');
    });
    // Settings over the Workspace: the sections nav on the left, General with the language radios.
    await timmy.shot('settings-general');

    const cards = dialog.getByTestId('provider-card');
    await test.step('Agents and providers lists the three Providers, all Disabled', async () => {
      await section('Agents and providers').click();
      await expect(section('Agents and providers')).toHaveAttribute('aria-current', 'page');
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(0)).toContainText('OpenCode');
      await expect(cards.nth(1)).toContainText('Claude Code');
      await expect(cards.nth(2)).toContainText('Codex');
      for (const n of [0, 1, 2]) await expect(cards.nth(n)).toContainText('Disabled');
      await expect(dialog.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible();
      await expect(dialog.getByTestId('hook-row')).toHaveCount(0);
    });
    await timmy.shot('settings-agents');

    await test.step('enabling Claude Code shows its Hook switch', async () => {
      const claude = cards.nth(1);
      await claude.getByRole('button', { name: 'Enable Claude Code' }).click();
      await expect(claude.getByRole('button', { name: 'Disable Claude Code' })).toBeVisible();
      await expect(claude).toContainText('Enabled');
      await expect(cards.nth(0)).toContainText('Disabled');
      const hook = claude.getByTestId('hook-row');
      await expect(hook).toHaveCount(1);
      await expect(hook.getByRole('switch', { name: 'Claude Code Hook' })).toHaveAttribute('aria-checked', 'false');
    });
    await timmy.shot('settings-agent-enabled');

    await test.step('Shortcuts lists the Workspace shortcuts, then the Pane and Stack ones', async () => {
      await section('Shortcuts').click();
      const rows = dialog.getByTestId('shortcut-row');
      await expect(rows).toHaveCount(12);
      await expect(rows.nth(5)).toContainText('Split the pane right');
      await expect(rows.nth(5)).toContainText(/Alt\s*Shift\s*R/);
      await expect(rows.nth(0)).toContainText('Collapse or expand the sidebar');
      await expect(rows.nth(0)).toContainText(/Ctrl\s*B/);
      await expect(rows.nth(1)).toContainText('Open or close Settings');
      await expect(rows.nth(1)).toContainText(/Ctrl\s*,/);
      await expect(rows.nth(2)).toContainText('New tab');
      await expect(rows.nth(2)).toContainText(/Ctrl\s*T/);
      await expect(rows.nth(3)).toContainText('Go to the tab with that number');
      await expect(rows.nth(3)).toContainText(/Ctrl\s*1–9/);
      await expect(rows.nth(4)).toContainText('Close Settings or a dialog');
      await expect(rows.nth(4)).toContainText('Esc');
    });
    await timmy.shot('settings-shortcuts');

    await test.step('a section still to come says so', async () => {
      await section(/Appearance/).click();
      await expect(section(/Appearance/)).toHaveAttribute('aria-current', 'page');
      await expect(dialog.getByTestId('coming-soon')).toBeVisible();
    });
    await timmy.shot('settings-coming-soon');

    await test.step('Esc closes it', async () => {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('Ctrl+, reopens it on the last section visited', async () => {
      await page.keyboard.press('Control+,');
      await expect(dialog).toBeVisible();
      await expect(section(/Appearance/)).toHaveAttribute('aria-current', 'page');
      await expect(dialog.getByTestId('coming-soon')).toBeVisible();
    });
  });
});
