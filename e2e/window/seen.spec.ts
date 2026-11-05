import { expect, test } from '../fixtures';

test.describe('a Done or Error Terminal stops affecting the Mascot once it is Seen', () => {
  test.use({ language: 'en' });

  test('a Terminal that fails in the Pill turns the Mascot red, and opening the Panel on it calms it', async ({ timmy }) => {
    const { page } = timmy;
    const mascot = page.locator('ui-pill ui-mascot');
    await timmy.openProjectTerminal();
    // It fails while the window is a Pill: nothing is on screen to see it.
    await timmy.run('Start-Sleep -Seconds 3; exit 1');
    await timmy.switchMode('Pill');
    await expect(mascot).toHaveAttribute('data-status', 'Error');
    await timmy.shot('seen-error-in-pill');

    await timmy.switchMode('Panel');
    const rail = page.locator('app-panel-rail');
    await expect(rail.locator('ui-mascot')).toHaveAttribute('data-status', 'Idle');
    await timmy.shot('seen-viewed-in-panel', { mask: [page.locator('app-terminal-screen .cwd'), page.locator('.xterm-screen')] });

    // It stays Seen when the window goes back to the Pill.
    await timmy.switchMode('Pill');
    await expect(mascot).toHaveAttribute('data-status', 'Idle');
    await expect(page.locator('ui-pill')).toContainText('Idle');
  });

  test('a Terminal that finishes while the Panel is open on it is Seen at once', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.switchMode('Panel');
    await timmy.run('exit 0');
    await expect(page.getByRole('button', { name: 'Close terminal' })).toBeEnabled();
    await expect(page.locator('app-panel-rail ui-mascot')).toHaveAttribute('data-status', 'Idle');
    await timmy.switchMode('Pill');
    await expect(page.locator('ui-pill ui-mascot')).toHaveAttribute('data-status', 'Idle');
  });
});
