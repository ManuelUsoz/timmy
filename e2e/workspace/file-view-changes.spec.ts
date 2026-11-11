import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('Cambios in a File View', () => {
  test.use({ language: 'en' });

  test('a Changed file has gutter bars in Archivo and its unified diff in Cambios', async ({ timmy }) => {
    const { page } = timmy;
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('src/main.ts', "export const answer = 42;\nexport const twice = (n: number) => n * 2;\nexport const name = 'timmy';\n");
    commitAll(timmy.projectDir);
    // What an agent left behind: one line changed and one added.
    write('src/main.ts', "export const answer = 42;\nexport const twice = (n: number) => n * 3;\nexport const name = 'timmy';\nexport const ready = true;\n");

    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar.getByRole('treeitem', { name, exact: true });
    const view = page.locator('app-file-view');
    const archivo = view.locator('.mode-bar button[data-mode=file]');
    const cambios = view.locator('.mode-bar button[data-mode=changes]');
    // The Terminal shows a prompt with the run's temporary folder: not part of what this spec checks.
    const behind = [page.locator('app-pane-stack').filter({ has: page.locator('app-terminal-screen') }).locator('.body')];

    await timmy.openProjectTerminal();
    await page.keyboard.press('Control+p');
    await expect(sidebar).toBeVisible();
    await row('src').click();
    await row('main.ts').click();

    await test.step('Archivo marks the changed lines with a bar in the gutter', async () => {
      await expect(archivo).toHaveAttribute('aria-pressed', 'true');
      await expect(cambios).toBeEnabled();
      await expect(view.locator('.gutter[data-kind=modified]')).toHaveCount(1);
      await expect(view.locator('.gutter[data-kind=added]')).toHaveCount(1);
      await timmy.shot('file-view-gutter-bars', { mask: behind });
    });

    await test.step('Cambios shows the same unified diff as the Quick look', async () => {
      await cambios.click();
      await expect(cambios).toHaveAttribute('aria-pressed', 'true');
      const diff = view.getByRole('region', { name: /^Changes of / });
      await expect(diff.locator('.row[data-kind=removed] .text')).toHaveText(['export const twice = (n: number) => n * 2;']);
      await expect(diff.locator('.row[data-kind=added] .sign')).toHaveText(['+', '+']);
      await timmy.shot('file-view-changes', { mask: behind });
    });
  });
});
