import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('The changed markers of the Files browser', () => {
  test.use({ language: 'en' });

  test('the tree marks what changed since the last commit, counts it, and shows only that on demand', async ({ timmy }) => {
    const { page } = timmy;
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('README.md', '# demo-project\n');
    write('package.json', '{}\n');
    write('src/app/core/handshake.service.ts', 'export const a = 1;\n');
    write('src/app/core/old.ts', 'export const old = 1;\n');
    write('src/main.ts', 'export const main = 1;\n');
    commitAll(timmy.projectDir);
    // What an agent leaves behind: an edit, a new file staged, an untracked file and folder, a delete.
    write('src/app/core/handshake.service.ts', 'export const a = 2;\n');
    write('src/app/core/retry.ts', 'export const retry = 1;\n');
    execFileSync('git', ['add', 'src/app/core/retry.ts'], { cwd: timmy.projectDir });
    write('notes.md', 'todo\n');
    write('generated/out.ts', 'export {};\n');
    rmSync(path.join(timmy.projectDir, 'src/app/core/old.ts'));
    write('package.json', '{ "name": "demo" }\n');

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const filesButton = page.getByRole('navigation', { name: /^Tabs of / }).getByRole('button', { name: 'Files' });
    const rows = sidebar.getByRole('treeitem');
    const count = sidebar.getByRole('button', { name: '6 changed' });
    const behind = [page.locator('app-pane-stack')];

    await timmy.openProjectTerminal();
    await filesButton.click();

    await test.step('each Changed file has its letter, a closed folder its count, and the section row the total', async () => {
      await expect(count).toBeVisible();
      await expect(count).toHaveAttribute('aria-pressed', 'false');
      await expect(rows).toHaveText(['generatedU', 'src3', 'notes.mdU', 'package.jsonM', 'README.md']);
      await rows.filter({ hasText: /^src/ }).click();
      await expect(rows.filter({ hasText: /^app/ })).toHaveText('app3');
      await rows.filter({ hasText: /^app/ }).click();
      await expect(rows).toHaveText([
        'generatedU',
        'src',
        'app/core',
        'handshake.service.tsM',
        'old.tsD',
        'retry.tsA',
        'main.ts',
        'notes.mdU',
        'package.jsonM',
        'README.md',
      ]);
      await expect(sidebar.locator('.as-treeitem__label--struck')).toHaveText('old.ts');
      await timmy.shot('changed-markers-tree', { mask: behind });
    });

    await test.step('"N changed" shows only the changed paths and their folders, all open, and back', async () => {
      await count.click();
      await expect(count).toHaveAttribute('aria-pressed', 'true');
      await expect(rows).toHaveText([
        'generatedU',
        'src/app/core',
        'handshake.service.tsM',
        'old.tsD',
        'retry.tsA',
        'notes.mdU',
        'package.jsonM',
      ]);
      await timmy.shot('changed-markers-changed-only', { mask: behind });
      await count.click();
      await expect(rows.first()).toHaveText('generatedU');
      await expect(rows).toHaveCount(10);
    });

    await test.step('coming back to the window reads git again', async () => {
      write('README.md', '# demo-project, edited\n');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(sidebar.getByRole('button', { name: '7 changed' })).toBeVisible();
      await expect(rows.last()).toHaveText('README.mdM');
    });
  });
});
