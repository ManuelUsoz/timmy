import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('The Files browser', () => {
  test.use({ language: 'en' });

  test('a panel on the right: the Project as a tree read folder by folder, and its files read in place', async ({ timmy }) => {
    const { page } = timmy;
    const write = (file: string, content: string | Buffer) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('.gitignore', 'node_modules/\n');
    write('README.md', '# demo-project\n\nA project to browse.\n');
    write('src/main.ts', "export const answer = 42;\nexport const long = 'a line that is wider than the sidebar so that it scrolls sideways instead of wrapping';\n");
    write('node_modules/pkg/index.js', 'module.exports = 1;\n');
    write('node_modules/.package-lock.json', '{}\n');
    write('electron/rpc/handshake.ts', 'export const handshake = 1;\n');
    write('electron/rpc/ipc-server.ts', 'export const server = 1;\n');
    write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]));
    // Committed, so no file is a Changed file: the markers have a spec of their own.
    commitAll(timmy.projectDir);

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const filesButton = page.getByRole('navigation', { name: /^Tabs of / }).getByRole('button', { name: 'Files' });
    const filter = sidebar.getByRole('searchbox', { name: 'Find a file' });
    const row = (name: string) => sidebar.getByRole('treeitem', { name, exact: true });
    // The Terminal behind shows a prompt with the run's temporary folder: not part of what this spec checks.
    const behind = [page.locator('app-pane-stack')];

    await timmy.openProjectTerminal();
    await expect(sidebar).toHaveCount(0);
    await expect(filesButton).toHaveAttribute('aria-pressed', 'false');

    await test.step('the Files icon opens it on the Project, with the filter ready; ignored folders are dimmed', async () => {
      await filesButton.click();
      await expect(sidebar).toBeVisible();
      await expect(filesButton).toHaveAttribute('aria-pressed', 'true');
      await expect(filter).toBeFocused();
      await expect(sidebar.getByRole('treeitem')).toHaveText(['electron', 'node_modules', 'src', '.gitignore', 'logo.png', 'README.md']);
      await expect(row('node_modules')).toHaveAttribute('data-dimmed', '');
      await timmy.shot('files-browser-tree', { mask: behind });
    });

    await test.step('the header has the title, refresh and close; the field shows Ctrl P; the Project heads the tree', async () => {
      await expect(sidebar.getByRole('heading', { name: 'Files' })).toBeVisible();
      await expect(sidebar.getByRole('button', { name: 'Refresh' })).toBeVisible();
      await expect(sidebar.getByRole('button', { name: 'Close files' })).toBeVisible();
      await expect(sidebar.locator('.field kbd')).toHaveText(['Ctrl', 'P']);
      await expect(sidebar.locator('.section-label')).toHaveText('demo-project');
    });

    await test.step('a chain of single-child folders opens as one row, and closes as one', async () => {
      await row('electron').click();
      await expect(row('electron/rpc')).toHaveAttribute('aria-expanded', 'true');
      await expect(row('handshake.ts')).toBeVisible();
      await expect(row('ipc-server.ts')).toBeVisible();
      await timmy.shot('files-browser-chain', { mask: behind });
      await row('electron/rpc').click();
      await expect(row('handshake.ts')).toHaveCount(0);
      await expect(row('electron/rpc')).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('a folder is read when it is opened, an ignored one too', async () => {
      await row('src').click();
      await expect(row('main.ts')).toBeVisible();
      await row('node_modules').click();
      await expect(row('pkg')).toBeVisible();
      await expect(row('pkg')).toHaveAttribute('data-dimmed', '');
      await row('node_modules').click();
      await expect(row('pkg')).toHaveCount(0);
    });

    await test.step('a file replaces the tree, with line numbers and a long line scrolling sideways', async () => {
      await row('main.ts').click();
      await expect(sidebar.getByRole('treeitem')).toHaveCount(0);
      await expect(sidebar.locator('.head .name')).toHaveText('main.ts');
      await expect(sidebar.locator('.gutter')).toHaveText('1\n2');
      await expect(sidebar.locator('.source')).toContainText('export const answer = 42;');
      const scrolls = await sidebar.locator('.code').evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(scrolls, 'the long line scrolls sideways').toBe(true);
      await timmy.shot('files-browser-file', { mask: behind });
    });

    await test.step("Esc goes back to the tree with the file highlighted; a binary file can't be previewed", async () => {
      await page.keyboard.press('Escape');
      await expect(sidebar.getByRole('treeitem').first()).toBeVisible();
      await expect(row('main.ts')).toHaveAttribute('aria-selected', 'true');
      await row('logo.png').click();
      await expect(sidebar.locator('.note')).toHaveText("Can't preview");
      await timmy.shot('files-browser-binary', { mask: behind });
      await sidebar.getByRole('button', { name: 'Back to the tree' }).click();
    });

    await test.step('Ctrl+P puts the keyboard in the filter, which lists matches by name and opens one with Enter', async () => {
      await row('README.md').click();
      await expect(sidebar.locator('.head .name')).toHaveText('README.md');
      await page.keyboard.press('Control+p');
      await expect(sidebar.getByRole('treeitem').first()).toBeVisible();
      await expect(filter).toBeFocused();
      await page.keyboard.type('MAIN');
      await expect(sidebar.getByRole('option')).toHaveText(['main.tssrc']);
      await timmy.shot('files-browser-filter', { mask: behind });
      await page.keyboard.press('Enter');
      await expect(sidebar.locator('.head .name')).toHaveText('main.ts');
    });

    await test.step('Esc leaves the file, then the sidebar; it opens again where it was left', async () => {
      await page.keyboard.press('Escape');
      await expect(filter).toHaveValue('');
      await page.keyboard.press('Escape');
      await expect(sidebar).toHaveCount(0);
      await expect(filesButton).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('Control+p');
      await expect(sidebar).toBeVisible();
      await expect(row('main.ts')).toHaveAttribute('aria-selected', 'true');
    });
  });
});
