import { expect, test } from '../fixtures';

test.describe('the Pill is led by the Mascot, colored by the highest-priority Terminal status', () => {
  test.use({ language: 'en' });

  test('is gray with nothing running, 440x88, and has no state dot', async ({ timmy }) => {
    const { page } = timmy;
    const b = await timmy.bounds();
    expect(Math.abs(b.width - 440)).toBeLessThanOrEqual(8);
    expect(Math.abs(b.height - 88)).toBeLessThanOrEqual(8);

    const mascot = page.locator('ui-pill ui-mascot');
    await expect(mascot).toHaveAttribute('data-status', 'Idle');
    await expect(page.locator('ui-pill')).toContainText('Idle');
    await expect(page.locator('ui-pill .as-dot')).toHaveCount(0);
    // The Mascot is on the left of the status word.
    const [mascotBox, wordBox] = await Promise.all([mascot.boundingBox(), page.locator('.as-pill__state').boundingBox()]);
    expect(mascotBox!.x + mascotBox!.width).toBeLessThanOrEqual(wordBox!.x);
    await timmy.shot('mascot-idle');
  });

  test('turns green while a Terminal runs and red when it exits with an error', async ({ timmy }) => {
    const { page } = timmy;
    const mascot = page.locator('ui-pill ui-mascot');

    await timmy.openProjectTerminal();
    await timmy.switchMode('Pill');
    await expect(mascot).toHaveAttribute('data-status', 'Working');
    await expect(page.locator('ui-pill')).toContainText('Live');
    // The corner stays anchored while the Pill grows from the Panel and back.
    const pillBounds = await timmy.bounds();
    await timmy.shot('mascot-working');

    await timmy.switchMode('Panel');
    await timmy.switchMode('Pill');
    const again = await timmy.bounds();
    expect(again.x + again.width).toBe(pillBounds.x + pillBounds.width);
    expect(again.y + again.height).toBe(pillBounds.y + pillBounds.height);

    await timmy.switchMode('Expanded');
    // It fails once the window is a Pill again: a Terminal that fails while on screen is Seen, and the Mascot stays calm.
    await timmy.run('Start-Sleep -Seconds 3; exit 1');
    await timmy.switchMode('Pill');
    await expect(mascot).toHaveAttribute('data-status', 'Error');
    await expect(page.locator('ui-pill')).toContainText('1 terminal failed');
    await timmy.shot('mascot-error');
  });

  test('turns purple when the process exits cleanly', async ({ timmy }) => {
    const { page } = timmy;
    await timmy.openProjectTerminal();
    await timmy.run('Start-Sleep -Seconds 3; exit 0');
    await timmy.switchMode('Pill');
    await expect(page.locator('ui-pill ui-mascot')).toHaveAttribute('data-status', 'Done');
    await expect(page.locator('ui-pill')).toContainText('1 terminal done');
    await timmy.shot('mascot-done');
  });

  test('crossfades its color in about 300 ms, and instantly under reduced motion', async ({ timmy }) => {
    const { page } = timmy;
    const duration = () => page.locator('ui-pill ui-mascot .body').evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(await duration()).toBe('0.3s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await duration()).toBe('0s');
  });
});
