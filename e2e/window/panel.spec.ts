import { expect, test } from '../fixtures';

test('Clicking the pill opens the Panel with the empty chat and the seeded session chips', async ({ timmy }) => {
  await timmy.openPanel();

  await test.step('panel is 440x560', async () => {
    const b = await timmy.bounds();
    expect(Math.abs(b.width - 440)).toBeLessThanOrEqual(8);
    expect(Math.abs(b.height - 560)).toBeLessThanOrEqual(8);
  });

  await test.step('empty state and seeded sessions visible', async () => {
    await expect(timmy.page.getByRole('heading', { name: 'Seguro?' })).toBeVisible();
    await timmy.text('Explain the window modes');
  });

  // Header, session chip strip with 3 chips, title row, empty hint, composer with model/effort/permission selects.
  await timmy.shot('panel-empty');
});
