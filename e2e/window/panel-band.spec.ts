import { expect, test } from '../fixtures';

test.describe('the Panel header is a Mascot band', () => {
  test.use({ language: 'en' });

  test('shows the gray Mascot, the title and the Idle word with nothing running, and double-click returns to the Pill', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openPanel();
    const band = page.locator('.panel-header');
    const mascot = band.locator('ui-mascot');

    await expect(mascot).toHaveAttribute('data-status', 'Idle');
    await expect(band.locator('.panel-title')).toHaveText('Terminals');
    await expect(band.locator('.panel-status')).toHaveText('Idle');
    const [bandBox, mascotBox, wordBox, switcherBox] = await Promise.all([
      band.boundingBox(),
      mascot.boundingBox(),
      band.locator('.panel-heading').boundingBox(),
      band.getByRole('button', { name: 'Change window mode' }).boundingBox(),
    ]);
    expect(Math.round(bandBox!.height)).toBe(88);
    expect(Math.round(mascotBox!.height)).toBe(72);
    // The Mascot leads on the left; the switcher and close are at the right.
    expect(mascotBox!.x + mascotBox!.width).toBeLessThanOrEqual(wordBox!.x);
    expect(wordBox!.x + wordBox!.width).toBeLessThanOrEqual(switcherBox!.x);
    await timmy.shot('panel-band-empty');

    // The Panel stays at the corner the Pill is anchored to.
    const panelBounds = await timmy.bounds();
    await mascot.dblclick();
    await timmy.settle(900);
    await expect(page.locator('ui-pill')).toBeVisible();
    const pillBounds = await timmy.bounds();
    expect(pillBounds.x + pillBounds.width).toBe(panelBounds.x + panelBounds.width);
    expect(pillBounds.y + pillBounds.height).toBe(panelBounds.y + panelBounds.height);
  });

  test('shows the same status as the Pill while a Terminal runs, and the terminal area is not shorter than before', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.switchMode('Panel');
    const panel = page.getByRole('region', { name: 'Timmy panel' });
    const band = panel.locator('.panel-header');

    await expect(band.locator('ui-mascot')).toHaveAttribute('data-status', 'Working');
    await expect(band.locator('.panel-status')).toHaveText('Live');
    // Before the band the header was 48 px high in a 560 px Panel: 512 px for the terminal area.
    const body = await panel.locator('app-panel-terminal').boundingBox();
    expect(body!.height).toBeGreaterThanOrEqual(512);
    await timmy.shot('panel-band-working', { mask: [page.locator('app-terminal-screen .cwd'), page.locator('.xterm-screen')] });

    await timmy.switchMode('Pill');
    await expect(page.locator('ui-pill ui-mascot')).toHaveAttribute('data-status', 'Working');
  });
});
