import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Timmy } from '../fixtures';

test.use({ language: 'en' });

// Fixture project (e2e/fixture/timmy-demo): README.md, src/{app,utils}.ts, docs/my notes/a b.md,
// and a .gitignore with `*.local`. The popup lists git-listed paths one folder level at a time.
const fixtureCwd = path.resolve(__dirname, '..', 'fixture', 'timmy-demo');

const popup = (timmy: Timmy) => timmy.page.locator('#mention-menu');
const options = (timmy: Timmy) => popup(timmy).getByRole('option');
const answered = async (timmy: Timmy) => {
  await timmy.text('Here is what I found.', 12000);
  await expect(timmy.page.getByRole('button', { name: 'Send' })).toBeVisible();
};

test('typing "@" at the start opens the file popup', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('@');
  await expect(options(timmy).first()).toBeVisible({ timeout: 8000 });
  // Root level: folders (docs/, src/) first, then files; keyboard hint footer; popup not clipped.
  await expect(popup(timmy).getByRole('option', { name: 'src/' })).toBeVisible();
  await expect(popup(timmy).getByRole('option', { name: 'README.md' })).toBeVisible();
  await timmy.shot('mention-popup-open');
});

test('"@" after a space opens the popup, an email address does not', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('mira @');
  await expect(options(timmy).first()).toBeVisible({ timeout: 8000 });

  await timmy.composer().fill('correo@dominio.com');
  await timmy.settle(300);
  await expect(popup(timmy)).toHaveCount(0);

  await timmy.composer().fill('mira @READ');
  await expect(popup(timmy).getByRole('option', { name: 'README.md' })).toBeVisible();
});

test('the list filters as you type', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('@READ');
  await expect(options(timmy)).toHaveCount(1);
  await expect(options(timmy).first()).toHaveText('README.md');

  await timmy.composer().fill('@zzzzqq');
  await expect(popup(timmy).getByText('No files match')).toBeVisible();
  await expect(options(timmy)).toHaveCount(0);
});

test('Tab inserts "@path " with a trailing space', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('mira @READ');
  await expect(options(timmy)).toHaveCount(1);
  await timmy.composer().press('Tab');
  await expect(timmy.composer()).toHaveValue('mira @README.md ');
  await expect(popup(timmy)).toHaveCount(0);
  // Focus never left the textarea.
  await expect(timmy.composer()).toBeFocused();
});

test('arrows move the highlight and Enter inserts instead of sending', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('@src/');
  await expect(options(timmy)).toHaveCount(2);
  await expect(options(timmy).nth(0)).toHaveAttribute('aria-selected', 'true');

  await timmy.composer().press('ArrowDown');
  await expect(options(timmy).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options(timmy).nth(0)).toHaveAttribute('aria-selected', 'false');
  await timmy.composer().press('ArrowUp');
  await expect(options(timmy).nth(0)).toHaveAttribute('aria-selected', 'true');
  await timmy.composer().press('ArrowDown');

  const second = (await options(timmy).nth(1).innerText()).trim();
  await timmy.composer().press('Enter');
  await expect(timmy.composer()).toHaveValue(`@src/${second} `);
  // Enter picked the row: nothing was sent.
  await expect(timmy.page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(timmy.page.getByText('Here is what I found.')).toHaveCount(0);
});

test('ArrowRight enters a folder, ArrowLeft goes back up', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('@sr');
  await expect(options(timmy)).toHaveCount(1);
  await expect(options(timmy).first()).toHaveText('src/');
  await timmy.composer().press('ArrowRight');
  await expect(timmy.composer()).toHaveValue('@src/');
  await expect(options(timmy).filter({ hasText: 'app.ts' })).toBeVisible();
  await timmy.composer().press('ArrowLeft');
  await expect(timmy.composer()).toHaveValue('@');
  await expect(options(timmy).filter({ hasText: 'README.md' })).toBeVisible();
});

test('Escape closes the popup and keeps the typed "@"', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('@READ');
  await expect(popup(timmy)).toBeVisible();
  await timmy.composer().press('Escape');
  await expect(popup(timmy)).toHaveCount(0);
  await expect(timmy.composer()).toHaveValue('@READ');
});

test('paths with spaces are inserted quoted', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('@docs/');
  await expect(options(timmy)).toHaveCount(1);
  await expect(options(timmy).first()).toHaveText('my notes/');
  await timmy.composer().press('Enter'); // enters the folder
  await expect(timmy.composer()).toHaveValue('@"docs/my notes/');
  await expect(options(timmy)).toHaveCount(1);
  await timmy.composer().press('Enter'); // picks the file
  await expect(timmy.composer()).toHaveValue('@"docs/my notes/a b.md" ');
});

test('git-ignored files never appear', async ({ timmy }) => {
  const secret = path.join(fixtureCwd, 'secret.local'); // matched by the fixture .gitignore (*.local)
  writeFileSync(secret, 'API_KEY=hunter2\n');
  try {
    await timmy.openPanel();
    await timmy.composer().fill('@secret');
    await expect(popup(timmy).getByText('No files match')).toBeVisible({ timeout: 8000 });
    await timmy.composer().fill('@READ');
    await expect(options(timmy)).toHaveCount(1); // the list is loaded, and still has no secret.local
  } finally {
    rmSync(secret, { force: true });
  }
});

test('files created by the agent show up after the next turn', async ({ timmy }) => {
  const fresh = path.join(fixtureCwd, 'fresh-from-agent.txt'); // untracked, not ignored
  try {
    await timmy.openPanel();
    await timmy.composer().fill('@READ');
    await expect(options(timmy)).toHaveCount(1); // list loaded without the new file
    await timmy.composer().fill('');
    writeFileSync(fresh, 'new\n');

    await timmy.send('hello there');
    await answered(timmy);

    await timmy.composer().fill('@fresh-from');
    await expect(options(timmy)).toHaveCount(1, { timeout: 8000 });
    await expect(options(timmy).first()).toHaveText('fresh-from-agent.txt');
  } finally {
    rmSync(fresh, { force: true });
  }
});

test('sending a valid mention shows a chip in the transcript', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.composer().fill('look at @README');
  await expect(options(timmy)).toHaveCount(1);
  await timmy.composer().press('Tab');
  await timmy.composer().pressSequentially('and nothing else');
  await expect(timmy.composer()).toHaveValue('look at @README.md and nothing else');
  await timmy.page.getByRole('button', { name: 'Send' }).click();
  await answered(timmy);

  const chip = timmy.page.locator('.mention-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('README.md');
  await expect(chip).not.toContainText('@');
  await expect(timmy.composer()).toHaveValue('');
  // User bubble with the text around a mono chip (file icon + name), then the answer.
  await timmy.shot('mention-chip-sent');
});

test('a quoted mention with spaces becomes a chip with the file name', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.send('read @"docs/my notes/a b.md" now');
  await answered(timmy);
  await expect(timmy.page.locator('.mention-chip')).toContainText('a b.md');
});

test('an email address is plain text, not a mention', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.send('write to correo@dominio.com today');
  await answered(timmy);
  await expect(timmy.page.locator('.mention-chip')).toHaveCount(0);
  await expect(timmy.page.getByRole('article', { name: 'You' }).getByText('write to correo@dominio.com today')).toBeVisible();
});

test('the same file mentioned twice sends fine and renders two chips', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.send('compare @README.md with @README.md');
  await answered(timmy);
  await expect(timmy.page.locator('.mention-chip')).toHaveCount(2);
});

const invalid: ReadonlyArray<{ title: string; mention: string; named: string }> = [
  { title: 'a nonexistent file', mention: '@nonexistent.ts', named: 'nonexistent.ts' },
  { title: 'a ".." path', mention: '@../package.json', named: '../package.json' },
  { title: 'an absolute path', mention: '@/etc/passwd', named: '/etc/passwd' },
  { title: 'a git-ignored file', mention: '@secret.local', named: 'secret.local' },
];

for (const { title, mention, named } of invalid) {
  test(`an invalid mention (${title}) fails the send and keeps the draft`, async ({ timmy }) => {
    const secret = path.join(fixtureCwd, 'secret.local');
    if (named === 'secret.local') writeFileSync(secret, 'API_KEY=hunter2\n');
    try {
      await timmy.openPanel();
      const draft = `check ${mention} now`;
      await timmy.send(draft);

      const error = timmy.page.locator('p.error');
      await expect(error).toContainText(`Invalid mention: ${named}`, { timeout: 8000 });
      // The draft is back in the composer, the session is still usable.
      await expect(timmy.composer()).toHaveValue(draft);
      await expect(timmy.composer()).toBeEnabled();
      // No turn started: Send (not Stop), no answer, and the message is not left in the transcript.
      await expect(timmy.page.getByRole('button', { name: 'Send' })).toBeVisible();
      await expect(timmy.page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
      await timmy.settle(600);
      await expect(timmy.page.getByText('Here is what I found.')).toHaveCount(0);
      await expect(timmy.page.locator('.mention-chip')).toHaveCount(0);
      if (named === 'nonexistent.ts') {
        // Red "Invalid mention: nonexistent.ts" line, draft still in the composer.
        await timmy.shot('mention-invalid-error');
      }
    } finally {
      rmSync(secret, { force: true });
    }
  });
}

test('a mention to a deleted file fails, and fixing the path lets the message through', async ({ timmy }) => {
  const doomed = path.join(fixtureCwd, 'doomed.txt');
  writeFileSync(doomed, 'soon gone\n');
  try {
    await timmy.openPanel();
    await timmy.composer().fill('@doomed');
    await expect(options(timmy)).toHaveCount(1, { timeout: 8000 }); // it was listed
    await timmy.composer().fill('');
    rmSync(doomed);

    await timmy.send('see @doomed.txt');
    await expect(timmy.page.locator('p.error')).toContainText('Invalid mention: doomed.txt', { timeout: 8000 });
    await expect(timmy.composer()).toHaveValue('see @doomed.txt');

    await timmy.composer().fill('see @README.md');
    await timmy.page.getByRole('button', { name: 'Send' }).click();
    await answered(timmy);
    await expect(timmy.page.locator('.mention-chip')).toContainText('README.md');
    expect(existsSync(doomed)).toBe(false);
  } finally {
    rmSync(doomed, { force: true });
  }
});
