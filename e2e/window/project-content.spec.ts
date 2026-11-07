import { expect, test } from '../fixtures';

test.use({ language: 'en' });

test('the sidebar has Projects, Terminals and Settings, and a Project shows its Terminals and files', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.addDemoProject();

  await test.step('the sidebar has no Chat or History links, only the Settings button', async () => {
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(sidebar.getByRole('link')).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(sidebar.getByRole('listbox', { name: 'Projects' }).getByRole('option', { name: 'demo-project' })).toHaveAttribute('aria-current', 'true');
    await expect(sidebar.getByRole('listbox', { name: 'Terminals' })).toContainText('No terminals yet.');
  });

  await test.step('the Project content has only Terminals and Files', async () => {
    const content = page.getByRole('region', { name: 'Project content' });
    await expect(content.getByRole('region', { name: 'Terminals' })).toBeVisible();
    await expect(content.getByRole('region', { name: 'Files' })).toBeVisible();
    await expect(content.getByRole('region')).toHaveCount(2);
  });

  // Sidebar with Projects, Terminals (none yet) and Settings; Project content with Terminals (empty) and Files; main area inviting to start a terminal.
  await timmy.shot('project-content-empty', { mask: [page.locator('.path')] });
});
