import { expect, test } from '../fixtures';

test.use({ language: 'en' });

const providerSelect = (t: { page: import('@playwright/test').Page }) => t.page.getByRole('button', { name: 'Provider' });

test('a new Session can start with either Provider, and shows that Provider\'s models', async ({ timmy }) => {
  await timmy.openPanel();

  await providerSelect(timmy).click();
  // Both Providers on offer.
  await expect(timmy.page.getByRole('option', { name: 'Claude' })).toBeVisible();
  await expect(timmy.page.getByRole('option', { name: 'OpenCode' })).toBeVisible();
  await timmy.shot('provider-picker-both');

  await timmy.page.getByRole('option', { name: 'OpenCode' }).click();
  await timmy.page.locator('.mp-trigger').click();
  await expect(timmy.page.getByRole('radio', { name: 'opencode/big-pickle' })).toBeVisible();
  await expect(timmy.page.getByRole('radio', { name: 'anthropic/claude-sonnet-5-5' })).toBeVisible();
  await expect(timmy.page.getByRole('radio', { name: 'mock-opus' })).toHaveCount(0);
  await timmy.shot('provider-opencode-models');
});

test('a Session keeps its Provider: it cannot be changed once the Session exists', async ({ timmy }) => {
  await timmy.openPanel();
  await providerSelect(timmy).click();
  await timmy.page.getByRole('option', { name: 'OpenCode' }).click();
  await timmy.send('hello');
  await timmy.text('Here is what I found.');
  // The choice is only offered before the first message; after it the Session is fixed to its Provider.
  await expect(providerSelect(timmy)).toHaveCount(0);
});

test.describe('unavailable', () => {
  test.use({ openCode: 'missing' });

  test('an unavailable Provider shows the Adapter\'s error and the previous Provider stays', async ({ timmy }) => {
    await timmy.openPanel();
    await providerSelect(timmy).click();
    await timmy.page.getByRole('option', { name: 'OpenCode' }).click();
    await expect(timmy.page.getByRole('alert')).toContainText('OpenCode is not installed');
    await expect(providerSelect(timmy)).toContainText('Claude');
    await timmy.shot('provider-unavailable');
  });
});
