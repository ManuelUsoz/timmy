import { expect, test } from '../fixtures';

test('typing "/" opens the command menu', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('/');
  await expect(timmy.page.getByText('/compact').first()).toBeVisible({ timeout: 8000 });
  // Menu with /compact, /review <branch>, /init, readable and not clipped by the window.
  await timmy.shot('slash-menu-open');
});

test('picking a session chip loads its stored conversation', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.page.getByText('Add a dark theme toggle').first().click();
  await timmy.text('The toggle lives in the panel header.');
  // Chip selected, title row shows the session, user + assistant messages and the Edit tool step.
  await timmy.shot('history-loaded');
});
