import { expect, test } from '../fixtures';

test('Timmy starts as a slim Pill at the bottom-right corner, idle', async ({ timmy }) => {
  const b = await timmy.bounds();
  expect(Math.abs(b.width - 440)).toBeLessThanOrEqual(8);
  expect(Math.abs(b.height - 40)).toBeLessThanOrEqual(8);
  await expect(timmy.page.locator('ui-pill')).toContainText('Nada en marcha');
  // Single slim bar: avatar, idle label, mode and close buttons. Nothing clipped.
  await timmy.shot('idle');
});
