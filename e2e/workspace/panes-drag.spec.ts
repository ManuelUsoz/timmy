import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/**
 * Holds a View's header down and drags it, in steps, to a point of `target` given as shares of its box; the button
 * stays down so the preview can be checked before `page.mouse.up()` drops.
 */
const dragTo = async (page: Page, header: Locator, target: Locator, at: { x: number; y: number }) => {
  const from = (await header.locator('.name').boundingBox())!;
  const box = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(box.x + box.width * at.x, box.y + box.height * at.y, { steps: 12 });
};

test.describe('Dragging a View to another Pane', () => {
  test.use({ language: 'en' });

  test('drops a View on an edge, in the centre, on a Stack\'s headers, and nowhere', async ({ timmy }) => {
    const { page } = timmy;
    const panes = page.locator('app-pane-stack');
    const names = (pane: Locator) => pane.locator('.view-header .name');
    const header = (name: string) => page.locator('.view-header', { has: page.locator('.name', { hasText: name }) });
    const preview = page.locator('.drop-preview');
    // The prompts show the run's temporary folder, which changes every run.
    const prompt = [page.locator('.xterm-screen')];

    await timmy.addDemoProject();
    await page.keyboard.press('Control+t');
    await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
    await page.locator('app-pane-stack.focused').getByRole('button', { name: 'Split right' }).click();
    await page.locator('app-pane-stack.focused').getByRole('button', { name: 'Add to stack' }).click();
    await expect(names(panes.nth(1))).toHaveText(['Terminal 2', 'Terminal 3']);

    await test.step('an edge over a Terminal previews half the Pane, and the View gets a new Pane on that side', async () => {
      await dragTo(page, header('Terminal 3'), panes.nth(0), { x: 0.1, y: 0.5 });
      await expect(preview).toBeVisible();
      await timmy.shot('panes-drag-edge-preview', { mask: prompt });
      await page.mouse.up();
      await expect(page.locator('.drop-overlay')).toHaveCount(0);
      await expect(panes).toHaveCount(3);
      await expect(page.locator('app-pane-stack .view-header.act .name')).toHaveText(['Terminal 3', 'Terminal 1', 'Terminal 2']);
      await expect(page.locator('app-pane-stack.focused .view-header.act .name')).toHaveText('Terminal 3');
      await timmy.shot('panes-drag-edge', { mask: prompt });
    });

    await test.step('the centre previews the whole Pane, and the View joins its Stack, expanded', async () => {
      await dragTo(page, header('Terminal 3'), panes.nth(2), { x: 0.5, y: 0.6 });
      await expect(preview).toBeVisible();
      await timmy.shot('panes-drag-center-preview', { mask: prompt });
      await page.mouse.up();
      await expect(panes).toHaveCount(2);
      await expect(names(panes.nth(1))).toHaveText(['Terminal 2', 'Terminal 3']);
      await expect(page.locator('app-pane-stack.focused .view-header.act .name')).toHaveText('Terminal 3');
      await timmy.shot('panes-drag-center', { mask: prompt });
    });

    await test.step('a Stack\'s headers show where the View would go, and it lands there', async () => {
      await dragTo(page, header('Terminal 1'), header('Terminal 2'), { x: 0.5, y: 0.25 });
      await expect(panes.nth(1).locator('.drop')).toBeVisible();
      await expect(preview).toHaveCount(0);
      await timmy.shot('panes-drag-stack-preview', { mask: prompt });
      await page.mouse.up();
      await expect(panes).toHaveCount(1);
      await expect(names(panes.nth(0))).toHaveText(['Terminal 1', 'Terminal 2', 'Terminal 3']);
      await timmy.shot('panes-drag-stack', { mask: prompt });
    });

    await test.step('the centre of its own Stack offers nothing; an edge of it moves the View out to that side', async () => {
      await dragTo(page, header('Terminal 2'), panes.nth(0), { x: 0.5, y: 0.6 });
      await expect(page.locator('.drop-overlay')).toHaveCount(1);
      await expect(preview).toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator('.drop-overlay')).toHaveCount(0);
      await expect(names(panes.nth(0))).toHaveText(['Terminal 1', 'Terminal 2', 'Terminal 3']);

      await dragTo(page, header('Terminal 2'), panes.nth(0), { x: 0.05, y: 0.5 });
      await expect(preview).toBeVisible();
      await page.mouse.up();
      await expect(panes).toHaveCount(2);
      await expect(names(panes.nth(0))).toHaveText(['Terminal 2']);
      await expect(names(panes.nth(1))).toHaveText(['Terminal 1', 'Terminal 3']);
      await timmy.shot('panes-drag-out-of-stack', { mask: prompt });
    });
  });
});
