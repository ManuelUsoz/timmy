import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('The Files browser', () => {
  test.use({ language: 'en' });

  test('a panel on the right: the Project as a tree read folder by folder, its files opened as File Views', async ({ timmy }) => {
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

    await test.step('a file opens as a File View beside the Terminal; the sidebar keeps the tree', async () => {
      await row('main.ts').click();
      const view = page.locator('app-pane-stack').filter({ has: page.locator('.view-header[data-kind=file]') });
      await expect(view.locator('.view-header .name')).toHaveText('main.ts');
      await expect(view.locator('.gutter')).toHaveText('1\n2');
      await expect(row('main.ts')).toHaveAttribute('aria-selected', 'true');
      await expect(sidebar.getByRole('treeitem').first()).toBeVisible();
    });

    await test.step('Ctrl+P puts the keyboard in the filter, which lists matches by name and opens one with Enter', async () => {
      await page.keyboard.press('Control+p');
      await expect(filter).toBeFocused();
      await page.keyboard.type('READ');
      await expect(sidebar.getByRole('option')).toHaveText(['README.md']);
      await timmy.shot('files-browser-filter', { mask: behind });
      await page.keyboard.press('Enter');
      await expect(page.locator('.view-header[data-kind=file] .name')).toHaveText(['README.md']);
    });

    await test.step('Esc closes the sidebar; it opens again where it was left', async () => {
      await filter.focus();
      await page.keyboard.press('Escape');
      await expect(sidebar).toHaveCount(0);
      await expect(filesButton).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('Control+p');
      await expect(sidebar).toBeVisible();
      // The filter is kept while the app runs, so more of its matches can be opened; cleared, the tree shows the file picked.
      await expect(filter).toHaveValue('READ');
      await filter.fill('');
      await expect(row('README.md')).toHaveAttribute('aria-selected', 'true');
    });
  });
});
