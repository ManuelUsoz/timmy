import { expect, test } from '../fixtures';

test('Collapsing to the Pill during a turn shows the running state in the pill', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.send('run a long task');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await timmy.switchMode('Pill');
  await expect(page.locator('.pill-bar')).toBeVisible();
  // Pill with running tone/pulse and a label describing the work.
  await timmy.shot('pill-while-running-running');
});
