import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commitAll, expect, STAND_IN_OUTPUT, test } from '../fixtures';

test.describe('The layout across restarts', () => {
  test.use({ language: 'en', providers: ['ClaudeCode'] });

  test('comes back as it was, with Idle Terminals that start on demand', async ({ timmy }) => {
    // A restart gives Timmy a new window, so everything is looked up on the page as it is now.
    const page = () => timmy.page;
    const bar = () => page().getByRole('navigation', { name: 'Tabs of demo-project' });
    const tab = (name: string) => bar().locator('.tab-button', { hasText: name });
    const panes = () => page().locator('app-pane-stack');
    const sidebarTerminals = () => page().getByRole('complementary', { name: 'Sidebar' }).getByRole('listbox', { name: 'Terminals' }).getByRole('option');
    const reopen = async () => {
      // Right after the last change: Timmy saves what is pending before it quits.
      await timmy.restart();
      await timmy.switchMode('Expanded');
      await page().locator('app-project-list .as-row__title', { hasText: 'demo-project' }).click();
    };

    await test.step('build a layout: Claude Code in a Tab split with a shell, and a second, renamed Tab', async () => {
      await timmy.addDemoProject();
      await bar().getByRole('button', { name: 'New tab' }).click();
      await page().getByRole('listbox', { name: 'New tab' }).getByRole('option', { name: 'Claude Code' }).click();
      await expect(page().locator('.xterm-screen')).toContainText(STAND_IN_OUTPUT, { timeout: 15_000 });
      await page().locator('app-pane-stack.focused').getByRole('button', { name: 'Split right' }).click();
      await page().getByRole('listbox', { name: 'Split right' }).getByRole('option', { name: 'Shell' }).click();
      await expect(panes()).toHaveCount(2);
      await expect(page().locator('.xterm-screen')).toHaveCount(2);

      await bar().getByRole('button', { name: 'New tab' }).click();
      await page().getByRole('listbox', { name: 'New tab' }).getByRole('option', { name: 'Shell' }).click();
      await expect(page().locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
      await tab('shell 3').dblclick();
      const field = bar().getByRole('textbox', { name: 'Tab name' });
      await field.fill('scratch');
      await field.press('Enter');
      await expect(tab('scratch')).toBeVisible();
      await expect(sidebarTerminals()).toHaveCount(3);
    });

    await test.step('after a restart the Tabs, Panes and Terminals are back, none of them started', async () => {
      await reopen();
      await expect(bar().locator('.tab-button .name')).toHaveText(['claude 1', 'scratch']);
      await expect(sidebarTerminals()).toHaveCount(3);
      await tab('claude 1').click();
      await expect(panes()).toHaveCount(2);
      await expect(page().locator('app-terminal-screen .start')).toHaveCount(2);
      await expect(page().locator('app-pane-stack .view-header [data-activity]')).toHaveCount(0);
      await timmy.shot('restart-restored-idle');
    });

    await test.step('starting a Terminal runs its Provider in the Project folder, and only that one', async () => {
      const first = panes().nth(0);
      await first.getByRole('button', { name: 'Start' }).click();
      await expect(first.locator('.xterm-screen')).toContainText(STAND_IN_OUTPUT, { timeout: 15_000 });
      await expect(first.locator('.start')).toHaveCount(0);
      // The other Pane's Terminal is still not started.
      await expect(panes().nth(1).locator('.start')).toHaveCount(1);

      await panes().nth(1).getByRole('button', { name: 'Start' }).click();
      await expect(panes().nth(1).locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
      await expect(panes().nth(1).locator('.xterm-screen')).not.toContainText(STAND_IN_OUTPUT);
    });

    await test.step('closing a Tab removes its Terminals from the store: they do not come back', async () => {
      await bar().getByRole('button', { name: 'Close tab scratch' }).click();
      // Its Terminal was never started, so closing the Tab asks nothing.
      await expect(tab('scratch')).toHaveCount(0);
      await reopen();
      await expect(bar().locator('.tab-button .name')).toHaveText(['claude 1']);
      await expect(sidebarTerminals()).toHaveCount(2);
    });
  });
});

test.describe('Pinned File Views across restarts', () => {
  test.use({ language: 'en' });

  test('come back in their place and are read again; the preview does not, and a deleted file shows as gone', async ({ timmy }) => {
    // A restart gives Timmy a new window, so everything is looked up on the page as it is now.
    const page = () => timmy.page;
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(timmy.projectDir, file)), { recursive: true });
      writeFileSync(path.join(timmy.projectDir, file), content);
    };
    write('README.md', '# demo-project\n\nA project to browse.\n');
    write('notes.md', 'Soon deleted.\n');
    write('src/main.ts', 'export const answer = 42;\n');
    // Committed, so the tree shows no Changed file markers: they are not part of what this spec checks.
    commitAll(timmy.projectDir);

    const sidebar = () => page().getByRole('complementary', { name: 'Files' });
    const row = (name: string) => sidebar().getByRole('treeitem', { name, exact: true });
    const panes = () => page().locator('app-pane-stack');
    const fileHeaders = () => page().locator('.view-header[data-kind=file]');

    await test.step('pin two files beside the Terminal and leave a third as the preview', async () => {
      await timmy.openProjectTerminal();
      await page().keyboard.press('Control+p');
      await expect(sidebar()).toBeVisible();
      await row('README.md').dblclick();
      await row('notes.md').dblclick();
      await row('src').click();
      await row('main.ts').click();
      await expect(fileHeaders().locator('.name')).toHaveText(['README.md', 'notes.md', 'main.ts']);
      await expect(fileHeaders().locator('.tag')).toHaveText(['Preview']);
      await expect(page().getByRole('region', { name: 'Contents of main.ts' })).toContainText('answer = 42');
    });

    await test.step('after a restart the pinned ones are back in their Panes, read again from disk', async () => {
      // Nothing of a file's content is saved: what is on disk after the restart is what shows.
      write('README.md', '# demo-project\n\nRewritten before the restart.\n');
      rmSync(path.join(timmy.projectDir, 'notes.md'));
      await timmy.restart();
      await timmy.switchMode('Expanded');
      await page().locator('app-project-list .as-row__title', { hasText: 'demo-project' }).click();
      await page().getByRole('navigation', { name: 'Tabs of demo-project' }).locator('.tab-button').first().click();

      await expect(panes()).toHaveCount(3);
      await expect(page().locator('app-terminal-screen .start')).toHaveCount(1);
      await expect(fileHeaders().locator('.name')).toHaveText(['README.md', 'notes.md']);
      await expect(fileHeaders().locator('.tag')).toHaveCount(0);
      await expect(fileHeaders().getByRole('button', { name: 'Pinned' })).toHaveCount(2);
      await expect(page().getByRole('region', { name: 'Contents of README.md' })).toContainText('Rewritten before the restart.');
      await expect(panes().nth(2).locator('app-file-view .note')).toHaveText('The file no longer exists');
      await timmy.shot('restart-pinned-file-views');
    });
  });
});
