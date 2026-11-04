import { expect, test } from '../fixtures';

// PowerShell stands in for any program: it prints, rings the bell, or sends an OSC notification after a delay.
const BELL = 'Start-Sleep 6; Write-Host -NoNewline ([char]7)';
const NOTIFICATION = 'Start-Sleep 6; Write-Host -NoNewline "$([char]27)]9;Build finished$([char]7)"';

test.describe('Terminal activity from the output tap', () => {
  test.use({ language: 'en' });

  test('a Terminal that prints is Active, then Idle after a quiet period', async ({ timmy }) => {
    await timmy.openProjectTerminal();
    const badge = timmy.activity(0);
    await expect(badge).toHaveAttribute('data-activity', 'Idle', { timeout: 15_000 });
    await expect(badge).toHaveText('Idle');

    await timmy.run('echo timmy-printing');
    await expect(badge).toHaveAttribute('data-activity', 'Active');
    await expect(badge).toHaveText('Active');
    await timmy.shot('terminal-activity-active');

    await expect(badge).toHaveAttribute('data-activity', 'Idle', { timeout: 10_000 });
    await timmy.shot('terminal-activity-idle', { maskActivity: false });
  });

  for (const [signal, command] of [['a bell', BELL], ['an OSC notification', NOTIFICATION]] as const) {
    test(`${signal} marks a Terminal as needing attention until the user focuses it`, async ({ timmy }) => {
      const { page } = timmy;
      await timmy.openProjectTerminal();
      await expect(timmy.activity(0)).toHaveAttribute('data-activity', 'Idle', { timeout: 15_000 });
      await timmy.run(command);
      // Leave it for a second Terminal; the first one keeps running behind the list.
      await timmy.newTerminal();

      await expect(timmy.activity(0)).toHaveAttribute('data-activity', 'NeedsAttention', { timeout: 15_000 });
      await expect(timmy.activity(0)).toHaveText('Attention');
      await timmy.shot('terminal-activity-needs-attention', { maskActivity: false, mask: [timmy.activity(1)] });

      // It also shows on the Pill, where the Terminals are counted.
      await timmy.switchMode('Pill');
      const pill = page.locator('ui-pill');
      await expect(pill).toContainText('Attention');
      await expect(pill).toContainText('1 terminal needs you');
      await timmy.shot('pill-needs-attention');

      // Focusing the Terminal is what clears it.
      await timmy.switchMode('Expanded');
      await page.getByRole('region', { name: 'Terminals' }).getByRole('option').nth(0).click();
      await expect(timmy.activity(0)).not.toHaveAttribute('data-activity', 'NeedsAttention');
      await timmy.switchMode('Pill');
      await expect(pill).toContainText('2 terminals running');
    });
  }
});
