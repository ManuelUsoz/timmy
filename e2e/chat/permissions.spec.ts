import { test } from '../fixtures';

test('An edit asks for permission in an ask row; Allow lets the turn finish', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.send('please fix the startup mode');
  const allow = page.getByRole('button', { name: /^Allow:/ });
  await allow.first().waitFor({ state: 'visible', timeout: 8000 });

  // Activity tree with Read done, ask row "Edit …" with Deny and Allow buttons above the composer.
  await timmy.shot('permission-allow-asking');

  await allow.first().click();
  await test.step('turn completes after Allow', () => timmy.text('Done, the app now starts as a Panel.'));

  // Ask row gone, confirmation message, Send button back.
  await timmy.shot('permission-allow-allowed');
});

test('Deny declines the edit and the agent says so', async ({ timmy }) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.send('fix it');
  const deny = page.getByRole('button', { name: /^Deny:/ });
  await deny.first().waitFor({ state: 'visible', timeout: 8000 });
  await deny.first().click();
  await test.step('agent acknowledges denial', () => timmy.text('left the file unchanged'));

  // Ask row gone; the edit step shows as failed/declined in the activity tree.
  await timmy.shot('permission-deny-denied');
});
