import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { commitAll, expect, test } from '../fixtures';

/** A real RGBA PNG of `width` x `height`, each pixel from `colour`. */
const png = (width: number, height: number, colour: (x: number, y: number) => readonly [number, number, number, number]): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(colour(x, y), y * (1 + width * 4) + 1 + x * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
};

/** A blue disc on a transparent ground, so the checkerboard shows around it. */
const disc = png(160, 120, (x, y) => ((x - 80) ** 2 + (y - 60) ** 2 < 50 ** 2 ? [69, 137, 255, 255] : [0, 0, 0, 0]));

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">\n  <rect x="10" y="10" width="100" height="100" rx="16" fill="#24a148"/>\n  <circle cx="60" cy="60" r="28" fill="#ffffff"/>\n</svg>\n';

test.describe('Images in the reader', () => {
  test.use({ language: 'en' });

  test('an image shows fitted, an SVG as text or picture, and a binary file says so with a way out', async ({ timmy }) => {
    const { page } = timmy;
    const write = (file: string, content: string | Buffer) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('img/disc.png', disc);
    write('img/logo.svg', LOGO_SVG);
    write('docs/manual.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3072 - 9)]));
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar.getByRole('treeitem', { name, exact: true });
    const view = page.locator('app-file-view');
    const terminal = page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') });
    const behind = [terminal.locator('.body')];

    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    await expect(sidebar).toBeVisible();
    await row('img').click();

    await test.step('a PNG shows as a picture, fitted, with its size and weight in the status bar', async () => {
      await row('disc.png').click();
      const picture = view.locator('.picture img');
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(160);
      await expect(view.locator('.status > span')).toHaveText(['160 × 120', /KB|B$/, 'PNG']);
      await timmy.shot('file-image-fitted', { mask: behind });
    });

    await test.step('a click shows it at actual size, 1 fits it again', async () => {
      await view.locator('.picture img').click();
      await expect(view.locator('.picture')).toHaveClass(/actual/);
      await page.keyboard.press('1');
      await expect(view.locator('.picture')).not.toHaveClass(/actual/);
    });

    await test.step('an SVG opens as highlighted text, and as a picture on Image', async () => {
      await row('logo.svg').click();
      await expect(view.locator('.line .text').first()).toContainText('<svg');
      await expect(view.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
      await timmy.shot('file-image-svg-source', { mask: behind });
      await view.getByRole('button', { name: 'Image' }).click();
      const picture = view.locator('.picture img');
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(120);
      expect(await view.locator('svg').count(), 'the SVG is never in the page as markup').toBe(0);
      await expect(view.locator('.status > span')).toHaveText(['120 × 120', /B$/, 'SVG']);
      await timmy.shot('file-image-svg-image', { mask: behind });
    });

    await test.step('the choice holds for the next SVG and is stored', async () => {
      await row('disc.png').click();
      await row('logo.svg').click();
      await expect(view.getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'true');
      await view.getByRole('button', { name: 'Source' }).click();
    });

    await test.step('a PDF says it is a binary file, with its size, and offers to open it outside Timmy', async () => {
      await row('docs').click();
      await row('manual.pdf').click();
      await expect(view.locator('.note')).toHaveText('Binary file, 3.0 KB');
      await expect(view.getByRole('button', { name: 'Open outside Timmy' })).toBeVisible();
      await timmy.shot('file-image-binary', { mask: behind });
    });
  });
});
