import { expect, test } from '../fixtures';

test.use({ language: 'en' });

test('changing the permission mode mid-session under OpenCode keeps the Session and answers the next message', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.page.getByRole('button', { name: /Provider/ }).click();
  await timmy.page.getByRole('option', { name: 'OpenCode' }).click();
  await timmy.send('hello');
  await timmy.text('Here is what I found.');

  await timmy.page.getByRole('button', { name: 'Permissions', exact: true }).click();
  await timmy.page.getByRole('option', { name: 'Auto mode' }).click();
  await timmy.send('again');

  await expect(timmy.page.getByText('Here is what I found.')).toHaveCount(2, { timeout: 8000 });
  await expect(timmy.page.getByRole('alert')).toHaveCount(0);
});
