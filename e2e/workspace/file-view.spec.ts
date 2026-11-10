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
      await expect(text.locator('.line .number')).toHaveText(['1', '2']);
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

  test('source is highlighted by language, with a status bar that says what kind of file it is', async ({ timmy }) => {
    const { page } = timmy;
    const source = [
      "import { Injectable, signal } from '@angular/core';",
      '',
      '/** The state of the connection with main. */',
      "export type HandshakeState = 'idle' | 'ready' | 'failed';",
      '',
      'const MAX_ATTEMPTS = 5;',
      '',
      "@Injectable({ providedIn: 'root' })",
      'export class HandshakeService {',
      "  readonly state = signal<HandshakeState>('idle');",
      '',
      '  connect(attempt: number): boolean {',
      "    this.state.set('ready');",
      '    return attempt < MAX_ATTEMPTS;',
      '  }',
      '}',
      '',
    ].join('\r\n');
    mkdirSync(path.join(timmy.projectDir, 'src'), { recursive: true });
    writeFileSync(path.join(timmy.projectDir, 'src', 'handshake.service.ts'), source);
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const behind = [page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') }).locator('.body')];
    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    await sidebar.getByRole('treeitem', { name: 'src', exact: true }).click();
    await sidebar.getByRole('treeitem', { name: 'handshake.service.ts', exact: true }).click();

    const view = page.locator('app-file-view');
    // The colours come from the worker, after the plain text.
    await expect(view.locator('.tok-keyword').first()).toHaveText('import');
    await expect(view.locator('.tok-string').first()).toHaveText("'@angular/core'");
    await expect(view.locator('.tok-comment')).toHaveText(['/** The state of the connection with main. */']);
    await expect(view.locator('.tok-meta')).toHaveText(['@Injectable']);
    await expect(view.locator('.tok-number').first()).toHaveText('5');
    await expect(view.locator('.status > span')).toHaveText(['Ln –', 'TypeScript', 'CRLF', 'Spaces: 2', 'UTF-8']);
    // Line 1 is an import: the Breadcrumb is the path alone.
    await expect(view.locator('.breadcrumb .crumb')).toHaveText(['src', 'handshake.service.ts']);
    await timmy.shot('file-view-highlighted', { mask: behind });
  });

  test('the Breadcrumb shows the path, then the declarations that hold the line', async ({ timmy }) => {
    const { page } = timmy;
    const source = ['export class HandshakeService {', '  connect(attempt: number): boolean {', '    return attempt < 5;', '  }', '}', ''].join('\n');
    mkdirSync(path.join(timmy.projectDir, 'src', 'core'), { recursive: true });
    writeFileSync(path.join(timmy.projectDir, 'src', 'core', 'handshake.service.ts'), source);
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const behind = [page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') }).locator('.body')];
    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    // Open, a folder with only a folder inside becomes one row (`src/core`), open too.
    await sidebar.getByRole('treeitem', { name: 'src', exact: true }).click();
    await sidebar.getByRole('treeitem', { name: 'handshake.service.ts', exact: true }).click();

    const breadcrumb = page.getByRole('navigation', { name: 'Path and symbols' });
    // Lezer loads with the first file that has symbols; the path shows meanwhile.
    await expect(breadcrumb.locator('.crumb')).toHaveText(['src', 'core', 'handshake.service.ts', 'HandshakeService']);
    await expect(breadcrumb.locator('.crumb.strong')).toHaveText(['handshake.service.ts', 'HandshakeService']);
    await expect(page.locator('app-file-view .tok-keyword').first()).toHaveText('export');
    await timmy.shot('file-view-breadcrumb', { mask: behind });
  });
});
