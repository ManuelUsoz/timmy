import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('A File View', () => {
  test.use({ language: 'en' });

  test('a file picked in the tree opens in a Pane beside the Terminal: a preview, then pinned', async ({ timmy }) => {
    const { page } = timmy;
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('README.md', '# demo-project\n\nA project to browse.\n');
    write('src/main.ts', "export const answer = 42;\nexport const long = 'a line that is wider than the pane so that it scrolls sideways instead of wrapping, which it never does';\n");
    write('src/util.ts', 'export const twice = (n: number) => n * 2;\n');
    // Committed, so the tree shows no Changed file markers: they are not part of what this spec checks.
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar.getByRole('treeitem', { name, exact: true });
    const fileHeaders = page.locator('.view-header[data-kind=file]');
    const terminal = page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') });
    // The Terminal shows a prompt with the run's temporary folder: not part of what this spec checks.
    const behind = [terminal.locator('.body')];

    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    await expect(sidebar).toBeVisible();
    await row('src').click();

    await test.step('a click opens a preview File View in a Pane to the right of the Terminal, with the keyboard', async () => {
      await row('main.ts').click();
      await expect(page.locator('app-pane-stack')).toHaveCount(2);
      await expect(fileHeaders.locator('.name')).toHaveText(['main.ts']);
      await expect(fileHeaders.locator('.name')).toHaveClass(/preview/);
      await expect(fileHeaders.locator('.tag')).toHaveText(['Preview']);
      const text = page.getByRole('region', { name: 'Contents of main.ts' });
      await expect(text).toBeFocused();
      await expect(text.locator('.gutter')).toHaveText('1\n2');
      const scrolls = await text.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(scrolls, 'the long line scrolls sideways').toBe(true);
      await timmy.shot('file-view-preview', { mask: behind });
    });

    await test.step('the next click replaces the preview in its place, never a second View of one file', async () => {
      await row('util.ts').click();
      await expect(page.locator('app-pane-stack')).toHaveCount(2);
      await expect(fileHeaders.locator('.name')).toHaveText(['util.ts']);
      await row('util.ts').click();
      await expect(page.locator('app-pane-stack')).toHaveCount(2);
    });

    await test.step('a double click pins it; the next click opens a new preview beside it', async () => {
      await row('util.ts').dblclick();
      await expect(fileHeaders.locator('.tag')).toHaveCount(0);
      await expect(fileHeaders.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-pressed', 'true');
      await row('README.md').click();
      await expect(page.locator('app-pane-stack')).toHaveCount(3);
      await expect(fileHeaders.locator('.name')).toHaveText(['util.ts', 'README.md']);
      await timmy.shot('file-view-pinned-and-preview', { mask: behind });
    });

    await test.step('the pin button pins the preview; closing a File View leaves the Terminal', async () => {
      await fileHeaders.nth(1).getByRole('button', { name: 'Pin' }).click();
      await expect(fileHeaders.locator('.tag')).toHaveCount(0);
      await fileHeaders.nth(1).getByRole('button', { name: 'Close pane' }).click();
      await fileHeaders.nth(0).getByRole('button', { name: 'Close pane' }).click();
      await expect(fileHeaders).toHaveCount(0);
      await expect(terminal).toHaveCount(1);
    });
  });
});
