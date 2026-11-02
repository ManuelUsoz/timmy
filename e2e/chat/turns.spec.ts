import { expect, test } from '../fixtures';

test('A long turn can be stopped; the UI returns to idle', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.send('run a long task');
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  // Running state (Stop button, "Working…" or streamed text) is streaming and non-deterministic:
  // asserted above instead of screenshotted.
  await stop.click();
  await test.step('Send button returns', async () => {
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  });
  // Idle composer; the partial answer stays.
  await timmy.shot('stop-stopped');
});

test('Thinking blocks and subagent activity render', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.send('think and use an agent to search');
  await timmy.text('Here is what I found.', 12000);
  // Collapsible "Thinking" section, activity tree with a subagent (Explore) and its Grep step.
  await timmy.shot('thinking-and-agent-done');
});

test('A failed subagent shows why it failed', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.send('use a broken agent to search');
  await timmy.text('Here is what I found.', 12000);
  await test.step('failure reason shown', () => timmy.text('search index missing'));
  await timmy.shot('subagent-failed');
});

test('A failed turn shows an error and leaves the chat usable', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.send('make it fail with an error');
  await test.step('error shown', () => timmy.text('Mock failure'));
  await expect(timmy.composer()).toBeEnabled();
  // Red error line under the conversation; composer enabled.
  await timmy.shot('failure-failed');
});
