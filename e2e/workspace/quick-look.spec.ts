import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, test } from '../fixtures';

test.describe('The Quick look', () => {
  test.use({ language: 'en' });

  test('Space on a file row shows the file over the Workspace, walks its list, and is never a View', async ({ timmy }) => {
    const write = (file: string, content: string | Buffer) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('README.md', '# demo-project\n\nA project to browse.\n');
    write('src/main.ts', "export const answer = 42;\nexport const twice = (n: number) => n * 2;\n");
    write('src/util.ts', 'export const half = (n: number) => n / 2;\n');
    // Not text: the Quick look says so, as a File View does.
    write('logo.bin', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]));
    // Committed, so the tree shows no Changed file markers: they are not part of what this spec checks.
    commitAll(timmy.projectDir);

    // A restart gives Timmy a new window, so everything is looked up on the page as it is now.
    const page = () => timmy.page;
    const sidebar = () => page().getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar().getByRole('treeitem', { name, exact: true });
    const look = () => page().getByRole('dialog', { name: /^Quick look of / });
    const panes = () => page().locator('app-pane-stack');

    // No Terminal yet: its prompt (the run's temporary folder) would show, blurred, behind the Quick look in every shot.
    await timmy.addDemoProject();
    await page().keyboard.press('Control+p');
    await expect(sidebar()).toBeVisible();

    await test.step('Space in the filter field is a character, not the Quick look', async () => {
      await page().keyboard.type('a b');
      await expect(sidebar().getByRole('searchbox')).toHaveValue('a b');
      await expect(look()).toHaveCount(0);
      await sidebar().getByRole('searchbox').fill('');
    });

    await test.step('Space on a file of the tree opens it on that file, with the keyboard and a counter', async () => {
      await row('src').click();
      // The keyboard on the row without picking it: a click would open a File View.
      await row('main.ts').focus();
      await expect(row('main.ts')).toBeFocused();
      await page().keyboard.press('Space');
      await expect(look()).toBeVisible();
      await expect(look()).toBeFocused();
      await expect(look().locator('.name')).toHaveText('main.ts');
      await expect(look().locator('.dir')).toHaveText('src');
      await expect(look().locator('.counter')).toHaveText('1 of 4 in demo-project');
      await expect(look().locator('.source')).toContainText('export const answer = 42;');
      // Not a View: no Pane opened for it.
      await expect(panes()).toHaveCount(0);
      await timmy.shot('quick-look-file');
    });

    await test.step('Down walks the files of the tree, skipping folders, and stops at the last one', async () => {
      await page().keyboard.press('ArrowDown');
      await expect(look().locator('.name')).toHaveText('util.ts');
      await page().keyboard.press('ArrowDown');
      await expect(look().locator('.name')).toHaveText('logo.bin');
      await expect(look().locator('.counter')).toHaveText('3 of 4 in demo-project');
      await expect(look().locator('.note')).toHaveText("Can't preview");
      await timmy.shot('quick-look-binary');
      await page().keyboard.press('ArrowDown');
      await page().keyboard.press('ArrowDown');
      await expect(look().locator('.name')).toHaveText('README.md');
      await expect(look().locator('.counter')).toHaveText('4 of 4 in demo-project');
    });

    await test.step('Esc closes it, and the row of the last file shown has the keyboard and the selection', async () => {
      await page().keyboard.press('Escape');
      await expect(look()).toHaveCount(0);
      await expect(row('README.md')).toBeFocused();
      await expect(row('README.md')).toHaveAttribute('aria-selected', 'true');
      await expect(sidebar()).toBeVisible();
    });

    await test.step('Space on a filter result walks the results; Space again closes it on the result shown', async () => {
      await page().keyboard.press('Control+p');
      await expect(sidebar().getByRole('searchbox')).toBeFocused();
      await page().keyboard.type('.ts');
      const results = sidebar().getByRole('option');
      await expect(results).toHaveCount(2);
      await page().keyboard.press('ArrowDown');
      await expect(results.nth(0)).toBeFocused();
      await page().keyboard.press('Space');
      await expect(look().locator('.counter')).toHaveText('1 of 2 in demo-project');
      await page().keyboard.press('ArrowDown');
      await expect(look().locator('.name')).toHaveText('util.ts');
      await timmy.shot('quick-look-filter-result');
      await page().keyboard.press('Space');
      await expect(look()).toHaveCount(0);
      await expect(results.nth(1)).toBeFocused();
    });

    await test.step('Enter opens the file shown as a preview File View beside the Terminal and closes it', async () => {
      await timmy.newTerminal();
      await expect(panes()).toHaveCount(1);
      await page().keyboard.press('Control+p');
      await expect(sidebar().getByRole('searchbox')).toBeFocused();
      await sidebar().getByRole('searchbox').fill('.ts');
      await page().keyboard.press('ArrowDown');
      await page().keyboard.press('ArrowDown');
      await page().keyboard.press('Space');
      // Not a View: the Tab still has only its Terminal.
      await expect(panes()).toHaveCount(1);
      await expect(look().locator('.name')).toHaveText('util.ts');
      await page().keyboard.press('Enter');
      await expect(look()).toHaveCount(0);
      await expect(panes()).toHaveCount(2);
      const header = page().locator('.view-header[data-kind=file]');
      await expect(header.locator('.name')).toHaveText(['util.ts']);
      await expect(header.locator('.tag')).toHaveText(['Preview']);
      await expect(page().getByRole('region', { name: 'Contents of util.ts' })).toBeFocused();
    });

    await test.step('an open Quick look does not come back after a restart', async () => {
      await page().keyboard.press('Control+p');
      await expect(sidebar().getByRole('searchbox')).toBeFocused();
      await sidebar().getByRole('searchbox').fill('README');
      await expect(sidebar().getByRole('option')).toHaveCount(1);
      await page().keyboard.press('ArrowDown');
      await page().keyboard.press('Space');
      await expect(look()).toBeVisible();
      await timmy.restart();
      await timmy.switchMode('Expanded');
      await page().locator('app-project-list .as-row__title', { hasText: 'demo-project' }).click();
      await expect(page().getByRole('navigation', { name: 'Tabs of demo-project' })).toBeVisible();
      await expect(look()).toHaveCount(0);
    });
  });

  test('Left and Right switch between the file and its changes against the last commit', async ({ timmy }) => {
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('README.md', '# demo-project\n\nA project to browse.\n');
    write('src/main.ts', "export const answer = 42;\nexport const twice = (n: number) => n * 2;\nexport const name = 'timmy';\n");
    write('src/util.ts', 'export const half = (n: number) => n / 2;\n');
    commitAll(timmy.projectDir);
    // What an agent left behind: one line changed and one added.
    write('src/main.ts', "export const answer = 42;\nexport const twice = (n: number) => n * 3;\nexport const name = 'timmy';\nexport const ready = true;\n");

    const page = timmy.page;
    const sidebar = page.getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar.getByRole('treeitem', { name, exact: true });
    const look = page.getByRole('dialog', { name: /^Quick look of / });
    const archivo = look.locator('.mode button[data-mode=file]');
    const cambios = look.locator('.mode button[data-mode=changes]');
    const diff = look.getByRole('region', { name: /^Changes of / });

    await timmy.addDemoProject();
    await page.keyboard.press('Control+p');
    await expect(sidebar).toBeVisible();
    await row('src').click();
    await row('main.ts').focus();
    await page.keyboard.press('Space');
    await expect(look.locator('.name')).toHaveText('main.ts');
    await expect(archivo).toHaveAttribute('aria-pressed', 'true');
    await expect(cambios).toBeEnabled();
    await expect(cambios).toHaveText('Changes');

    await test.step('Right shows the changes, unified, each changed line with its sign', async () => {
      await page.keyboard.press('ArrowRight');
      await expect(cambios).toHaveAttribute('aria-pressed', 'true');
      await expect(diff).toBeVisible();
      await expect(diff.locator('.row[data-kind=removed] .text')).toHaveText(['export const twice = (n: number) => n * 2;']);
      await expect(diff.locator('.row[data-kind=added] .text')).toHaveText(['export const twice = (n: number) => n * 3;', 'export const ready = true;']);
      await expect(diff.locator('.row[data-kind=added] .sign')).toHaveText(['+', '+']);
      await timmy.shot('quick-look-changes');
    });

    await test.step('walking onto a file with no changes falls back to the file, with Cambios disabled in its place', async () => {
      await page.keyboard.press('ArrowDown');
      await expect(look.locator('.name')).toHaveText('util.ts');
      await expect(archivo).toHaveAttribute('aria-pressed', 'true');
      await expect(cambios).toBeDisabled();
      await expect(cambios).toHaveText('No changes');
      await expect(look.locator('.source')).toContainText('export const half');
      await page.keyboard.press('ArrowRight');
      await expect(archivo).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('Left goes back to the file', async () => {
      await page.keyboard.press('ArrowUp');
      await expect(cambios).toBeEnabled();
      await page.keyboard.press('ArrowRight');
      await expect(diff).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await expect(archivo).toHaveAttribute('aria-pressed', 'true');
      await expect(look.locator('.source')).toContainText('export const ready = true;');
    });
  });
});
