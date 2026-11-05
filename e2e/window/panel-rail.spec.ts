import { expect, test } from '../fixtures';

test.describe('the Panel rail leads with the Mascot', () => {
  test.use({ language: 'en' });

  test('shows the gray Mascot and says nothing is running, with the switcher and close at the foot, and double-click returns to the Pill', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openPanel();
    const rail = page.locator('app-panel-rail');
    const mascot = rail.locator('ui-mascot');

    await expect(mascot).toHaveAttribute('data-status', 'Idle');
    await expect(rail.locator('.tally')).toHaveText('Nothing running');
    const [railBox, mascotBox, tallyBox, switcherBox, mainBox] = await Promise.all([
      rail.boundingBox(),
      mascot.boundingBox(),
      rail.locator('.tally').boundingBox(),
      rail.getByRole('button', { name: 'Change window mode' }).boundingBox(),
      page.locator('app-panel-terminal .main').boundingBox(),
    ]);
    expect(Math.round(railBox!.width)).toBe(248);
    expect(Math.round(mascotBox!.height)).toBe(64);
    // The Mascot leads on the left with its words after it; the controls are at the foot of the rail; the Terminal is beside it.
    expect(mascotBox!.x + mascotBox!.width).toBeLessThanOrEqual(tallyBox!.x);
    expect(switcherBox!.y).toBeGreaterThan(mascotBox!.y + mascotBox!.height);
    expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(mainBox!.x);
    await timmy.shot('panel-rail-empty');

    // The Panel stays at the corner the Pill is anchored to.
    const panelBounds = await timmy.bounds();
    await mascot.dblclick();
    await timmy.settle(900);
    await expect(page.locator('ui-pill')).toBeVisible();
    const pillBounds = await timmy.bounds();
    expect(pillBounds.x + pillBounds.width).toBe(panelBounds.x + panelBounds.width);
    expect(pillBounds.y + pillBounds.height).toBe(panelBounds.y + panelBounds.height);
  });

  test('shows the same status as the Pill while a Terminal runs, and the Terminal as a line of its Project', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.switchMode('Panel');
    const panel = page.getByRole('region', { name: 'Timmy panel' });
    const rail = panel.locator('app-panel-rail');

    await expect(rail.locator('ui-mascot')).toHaveAttribute('data-status', 'Working');
    await expect(rail.locator('.tally ui-state')).toHaveText(['1 live']);
    await expect(rail.locator('as-list-group-label')).toContainText('demo-project');
    const row = rail.getByRole('option', { name: /Terminal 1/ });
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row).toContainText('Shell');
    await timmy.shot('panel-rail-working', { mask: [page.locator('app-terminal-screen .cwd'), page.locator('.xterm-screen')] });

    await timmy.switchMode('Pill');
    await expect(page.locator('ui-pill ui-mascot')).toHaveAttribute('data-status', 'Working');
  });
});
