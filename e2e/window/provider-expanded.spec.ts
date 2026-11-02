import { expect, test } from '../fixtures';

test.use({ language: 'en' });

/** Adds the demo project (the e2e app's folder picker answers with it) and opens a new, empty Session in it. */
const openEmptySession = async (timmy: import('../fixtures').Timmy) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.switchMode('Expanded');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('button', { name: 'Browse' }).click();
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'New session' }).first().click();
  await page.waitForURL(/\/projects\/[^/]+\/sessions\/[^/]+/);
};

for (const [from, to] of [
  ['Claude', 'OpenCode'],
  ['OpenCode', 'Claude'],
] as const) {
  test(`Expanded: an empty Session changes Provider ${from} to ${to} and stays open`, async ({ timmy }) => {
    const { page } = timmy;
    await openEmptySession(timmy);
    const provider = page.getByRole('button', { name: /Provider/ });
    if (from === 'OpenCode') {
      await provider.click();
      await page.getByRole('option', { name: 'OpenCode' }).click();
    }
    await expect(provider).toHaveAccessibleName(`Provider: ${from}`);
    const url = page.url();

    await provider.click();
    await page.getByRole('option', { name: to }).click();

    await expect(provider).toHaveAccessibleName(`Provider: ${to}`);
    await timmy.settle();
    // Same route, same chat, one Session in the list.
    expect(page.url()).toBe(url);
    await expect(timmy.composer()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sessions' }).locator('.as-row')).toHaveCount(1);
    await timmy.shot(`provider-expanded-${from.toLowerCase()}-to-${to.toLowerCase()}`, { mask: [page.locator('.as-row__sub'), page.locator('.path')] });
  });
}
