import { expect, test } from '../fixtures';

test.use({ language: 'en' });

test('the rail has Projects and Settings, and a Project shows its Terminals and files', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.addDemoProject();

  await test.step('the rail has no Chat or History', async () => {
    const rail = page.getByRole('navigation', { name: 'Primary' });
    await expect(rail.getByRole('link')).toHaveCount(2);
    await expect(rail.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  await test.step('the Project content has only Terminals and Files', async () => {
    const content = page.getByRole('region', { name: 'Project content' });
    await expect(content.getByRole('region', { name: 'Terminals' })).toBeVisible();
    await expect(content.getByRole('region', { name: 'Files' })).toBeVisible();
    await expect(content.getByRole('region')).toHaveCount(2);
  });

  // Rail of two areas; Projects column; Project content with Terminals (empty) and Files; main area inviting to start a terminal.
  await timmy.shot('project-content-empty', { mask: [page.locator('.as-row__sub'), page.locator('.path')] });
});
