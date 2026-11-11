import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';
import { png } from '../png';

/** A blue disc on a transparent ground. */
const disc = png(160, 120, (x, y) => ((x - 80) ** 2 + (y - 60) ** 2 < 50 ** 2 ? [69, 137, 255, 255] : [0, 0, 0, 0]));

const README = [
  '# Timmy demo',
  '',
  'A **rendered** README with `inline code`, a [guide](docs/guide.md), a [folder](docs/), a [section](#usage) and a [site](https://example.com).',
  '',
  '## Usage',
  '',
  '```ts',
  "export const answer: number = 42; // the answer",
  '```',
  '',
  '| Name | Kind |',
  '| ---- | ---- |',
  '| main | file |',
  '| docs | folder |',
  '',
  '![the disc](img/disc.png)',
  '',
  '[outside](../../secret.md) and ![remote](https://example.com/logo.png)',
  '',
].join('\n');

test.describe('Markdown in the reader', () => {
  test.use({ language: 'en' });

  test('Fuente by default, Renderizado with code, a table and an image; a click never navigates the window', async ({ timmy }) => {
    const { page } = timmy;
    const write = (file: string, content: string | Buffer) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('README.md', README);
    write('docs/guide.md', '# Guide\n\nThe guide.\n');
    write('img/disc.png', disc);
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar.getByRole('treeitem', { name, exact: true });
    const views = page.locator('app-file-view');
    const terminal = page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') });
    const behind = [terminal.locator('.body')];

    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    await expect(sidebar).toBeVisible();
    await row('README.md').click();
    const view = views.first();

    await test.step('it opens in Source, with the toggle to Rendered', async () => {
      await expect(view.locator('.line .text').first()).toContainText('# Timmy demo');
      await expect(view.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
      await timmy.shot('file-markdown-source', { mask: behind });
    });

    await test.step('Rendered shows the page: highlighted code, a table, the image and links that go nowhere as plain text', async () => {
      await view.getByRole('button', { name: 'Rendered' }).click();
      const page_ = view.locator('.markdown-body');
      await expect(page_.locator('h1')).toHaveText('Timmy demo');
      await expect(page_.locator('pre code .tok-keyword').first()).toBeVisible();
      await expect(page_.locator('table td').first()).toHaveText('main');
      const image = page_.locator('img');
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(160);
      await expect(page_.locator('.inert')).toHaveText(['outside', 'remote']);
      expect(await view.locator('.line').count(), 'no Line selection layer in Rendered').toBe(0);
      await timmy.shot('file-markdown-rendered', { mask: behind });
    });

    await test.step('a click on an anchor, a folder or an outside link never navigates the window', async () => {
      const before = page.url();
      const page_ = view.locator('.markdown-body');
      await page_.getByRole('link', { name: 'section' }).click();
      await page_.getByText('outside').click();
      await page_.getByText('remote').click();
      await page_.getByRole('link', { name: 'folder' }).click();
      await expect(row('guide.md')).toBeVisible();
      expect(page.url()).toBe(before);
      await expect(page_.locator('h1')).toBeVisible();
    });

    await test.step('a link to a file of the Project replaces the preview File View with it', async () => {
      await view.locator('.markdown-body').getByRole('link', { name: 'guide' }).click();
      await expect(page.locator('.view-header[data-kind=file] .name')).toHaveText(['guide.md']);
      await expect(view.locator('.markdown-body h1')).toHaveText('Guide');
    });

    await test.step('Source is one click away', async () => {
      await view.getByRole('button', { name: 'Source' }).click();
      await expect(view.locator('.line .text').first()).toContainText('# Guide');
    });
  });
});
