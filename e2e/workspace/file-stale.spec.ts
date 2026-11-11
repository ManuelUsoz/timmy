import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('A File View whose file changed on disk', () => {
  test.use({ language: 'en' });

  test('says it changed, and reloads on request; then says it is gone, dimmed and struck through', async ({ timmy }) => {
    const { page } = timmy;
    const file = path.join(timmy.projectDir, 'notes.ts');
    writeFileSync(file, ['export const one = 1;', 'export const two = 2;', 'export const three = 3;'].join('\n') + '\n');
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const fileHeader = page.locator('.view-header[data-kind=file]');
    const terminal = page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') });
    // The Terminal shows a prompt with the run's temporary folder: not part of what this spec checks.
    const behind = [terminal.locator('.body')];
    const text = page.getByRole('region', { name: 'Contents of notes.ts' });
    const notice = page.locator('app-file-view .notice');
    /** What the window taking the focus does: one check of every open File View. */
    const focusWindow = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole('treeitem', { name: 'notes.ts', exact: true }).click();
    await expect(text.locator('.line .number')).toHaveText(['1', '2', '3']);
    await expect(notice).toHaveCount(0);

    await test.step('the file changes on disk: a slim bar with Reload, and the text is not replaced', async () => {
      writeFileSync(file, ['export const one = 1;', 'export const two = 22;', 'export const three = 3;', 'export const four = 4;'].join('\n') + '\n');
      await focusWindow();
      await expect(notice).toContainText('The file changed on disk');
      await expect(text.locator('.line .number')).toHaveText(['1', '2', '3']);
      await timmy.shot('file-view-stale', { mask: behind });
    });

    await test.step('Reload reads the file again and the bar goes', async () => {
      await notice.getByRole('button', { name: 'Reload' }).click();
      await expect(notice).toHaveCount(0);
      await expect(text.locator('.line .number')).toHaveText(['1', '2', '3', '4']);
    });

    await test.step('the file is deleted: its last text stays dimmed under a bar with no Reload, the name struck through', async () => {
      rmSync(file);
      await focusWindow();
      await expect(notice).toContainText('The file no longer exists on disk');
      await expect(notice.getByRole('button')).toHaveCount(0);
      await expect(text.locator('.line .number')).toHaveText(['1', '2', '3', '4']);
      await expect(fileHeader.locator('.name')).toHaveClass(/gone/);
      await timmy.shot('file-view-gone', { mask: behind });
    });
  });
});
