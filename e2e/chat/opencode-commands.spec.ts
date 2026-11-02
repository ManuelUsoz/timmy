import { expect, test } from '../fixtures';

test.use({ language: 'en' });

test('under OpenCode the slash menu lists OpenCode\'s commands, including the project\'s own', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.page.getByRole('button', { name: /Provider/ }).click();
  await timmy.page.getByRole('option', { name: 'OpenCode' }).click();

  await timmy.composer().fill('/');
  await expect(timmy.page.getByText('/ship').first()).toBeVisible({ timeout: 8000 });
  // OpenCode's own list, not Claude's: no /compact.
  await expect(timmy.page.getByText('/compact')).toHaveCount(0);
  await timmy.shot('slash-menu-opencode');
});
