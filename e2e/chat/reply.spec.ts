import { expect, test } from '../fixtures';

test('A plain message streams a markdown answer and shows context usage', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.send('Explain the architecture');

  await test.step('answer rendered as markdown', async () => {
    await timmy.text('Here is what I found.');
    await expect(page.locator('.markdown code').first()).toBeVisible();
    await expect(page.getByText('27%').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  });

  // The streaming state is not screenshotted: it is mid-flight and non-deterministic.
  // Rendered markdown (list + code block), context 27% in the composer bar, Send button back.
  await timmy.shot('reply-done');
});
