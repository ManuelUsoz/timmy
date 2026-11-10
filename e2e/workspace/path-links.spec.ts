import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { commitAll, expect, test } from '../fixtures';

/** The middle of where `text` is drawn on the Terminal's screen, in page pixels. */
const placeOf = (page: Page, text: string) =>
  page.evaluate((wanted) => {
    const rows = document.querySelector('.xterm-rows');
    if (rows === null) return undefined;
    const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const box = range.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return undefined;
  }, text);

test.describe('Path links', () => {
  test.use({ language: 'en' });

  test('a path a Terminal prints is underlined on hover, and Ctrl+click opens it on its line', async ({ timmy }) => {
    const { page } = timmy;
    mkdirSync(path.join(timmy.projectDir, 'src'), { recursive: true });
    const lines = Array.from({ length: 80 }, (_, index) => `export const line${index + 1} = ${index + 1};`);
    writeFileSync(path.join(timmy.projectDir, 'src', 'answer.ts'), lines.join('\n') + '\n');
    commitAll(timmy.projectDir);

    await timmy.openProjectTerminal();
    await timmy.run("cls; Write-Output 'error TS2322 at src/answer.ts:42:7, see the type above'");
    const terminal = page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') });
    await expect(terminal.locator('.xterm-rows')).toContainText('src/answer.ts:42:7,');
    // The prompt shows the run's temporary folder, and the cursor blinks on it: not part of what this spec checks.
    const prompt = terminal.locator('.xterm-rows > div').filter({ hasText: /^PS / });
    const hint = page.getByRole('tooltip');

    await test.step('hovering the path underlines it and tells what Ctrl+click opens', async () => {
      const place = await placeOf(page, 'src/answer.ts:42:7');
      expect(place).toBeDefined();
      await page.mouse.move(place!.x, place!.y);
      await expect(hint).toBeVisible();
      await expect(hint.locator('.link-path')).toHaveText('src/answer.ts:42');
      await expect(hint.locator('.link-key')).toHaveText('Ctrl+click to open');
      await timmy.shot('path-links-hover', { mask: [prompt] });
    });

    await test.step('a plain click opens nothing', async () => {
      await page.mouse.down();
      await page.mouse.up();
      await expect(page.locator('app-file-view')).toHaveCount(0);
    });

    await test.step('Ctrl+click opens a preview File View beside the Terminal with line 42 marked', async () => {
      await page.keyboard.down('Control');
      await page.mouse.down();
      await page.mouse.up();
      await page.keyboard.up('Control');
      const view = page.locator('app-file-view');
      await expect(view).toHaveCount(1);
      await expect(page.locator('.view-header[data-kind=file] .name')).toHaveText(['answer.ts']);
      await expect(view.locator('.status > span').first()).toHaveText('Ln 42 of 80');
      await expect(view.locator('.marks .selected')).toBeVisible();
      await expect(view.locator('.line[data-line="42"]')).toBeInViewport();
      await expect(view.locator('.line[data-line="1"]')).not.toBeInViewport();
    });
  });
});
