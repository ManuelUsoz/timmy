import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Timmy } from '../fixtures';

/** Git for Windows ships the bash that Claude Code runs its Hooks in. */
const findBash = (): string | undefined => {
  if (process.env['TIMMY_E2E_BASH']) return process.env['TIMMY_E2E_BASH'];
  if (process.platform !== 'win32') return 'bash';
  try {
    const bash = path.join(path.resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '..', '..', '..'), 'bin', 'bash.exe');
    return existsSync(bash) ? bash : undefined;
  } catch {
    return undefined;
  }
};

const claudeSettings = (timmy: Timmy) => path.join(timmy.userData, 'claude', 'settings.json');
const hookCommand = (timmy: Timmy): string => JSON.parse(readFileSync(claudeSettings(timmy), 'utf8')).hooks.Stop[0].hooks[0].command;

/** Settings → Agents and providers, in Expanded: the Claude Code card (the spec enables Claude Code from the start). */
const openHooks = async (timmy: Timmy) => {
  const { page } = timmy;
  await timmy.openPanel();
  await timmy.switchMode('Expanded');
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Agents and providers' }).click();
  const card = dialog.getByTestId('provider-card').filter({ hasText: 'Claude Code' });
  await expect(card).toContainText('Enabled');
  return card;
};

/** The Claude Code Hook switch inside its card. */
const hookSwitch = (card: Awaited<ReturnType<typeof openHooks>>) => card.getByTestId('hook-row').getByRole('switch', { name: 'Claude Code Hook' });

/** Turns the Hook on from its card and waits until it says so. */
const activateHook = async (timmy: Timmy) => {
  const toggle = hookSwitch(await openHooks(timmy));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
};

test.describe('Settings → Agents and providers: the Claude Code Hook', () => {
  test.use({ language: 'en', providers: ['ClaudeCode'] });

  test('activates and deactivates the Hook, touching only its own entries', async ({ timmy }) => {
    // The user already has their own settings and hook; they must survive both ways.
    mkdirSync(path.dirname(claudeSettings(timmy)), { recursive: true });
    const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo theirs' }] }] } };
    writeFileSync(claudeSettings(timmy), JSON.stringify(theirs));

    const card = await openHooks(timmy);
    await expect(card.getByTestId('hook-row')).toHaveCount(1);
    const toggle = hookSwitch(card);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await timmy.shot('hooks-inactive');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await timmy.shot('hooks-active');
    const written = JSON.parse(readFileSync(claudeSettings(timmy), 'utf8'));
    expect(written.model).toBe('opus');
    expect(written.hooks.Stop[0]).toEqual(theirs.hooks.Stop[0]);
    expect(JSON.stringify(written)).toContain('TIMMY_TERMINAL_ID');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(JSON.parse(readFileSync(claudeSettings(timmy), 'utf8'))).toEqual(theirs);
  });

  test('the Hook command does nothing outside a Terminal started by Timmy', async ({ timmy }) => {
    const bash = findBash();
    test.skip(bash === undefined, 'needs bash (Git for Windows)');
    await activateHook(timmy);

    const env = { ...process.env };
    delete env['TIMMY_TERMINAL_ID'];
    delete env['TIMMY_HOOK_URL'];
    const out = execFileSync(bash!, ['-c', hookCommand(timmy)], { input: '{"hook_event_name":"UserPromptSubmit"}', env, encoding: 'utf8' });
    expect(out).toBe('');
  });
});

test.describe('Terminal state from the Claude Code Hook', () => {
  test.use({ language: 'en', providers: ['ClaudeCode'] });

  test('follows working, waiting for you and done, as the Hook command posts them', async ({ timmy }) => {
    const bash = findBash();
    test.skip(bash === undefined, 'needs bash (Git for Windows)');
    const { page } = timmy;
    await activateHook(timmy);
    // Settings is a dialog over the Workspace: close it to reach the sidebar.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

    // The command Timmy wrote into Claude Code's settings, run by bash as Claude Code would run it.
    const scripts = mkdtempSync(path.join(tmpdir(), 'timmy-e2e-hook-'));
    try {
      const script = path.join(scripts, 'hook.sh').replace(/\\/g, '/');
      writeFileSync(script, `${hookCommand(timmy)}\n`);
      const bashPath = bash!.replace(/\\/g, '/');
      const send = (payload: object) => timmy.run(`'${JSON.stringify(payload)}' | & '${bashPath}' '${script}'`);

      // Already in Expanded, so add the project here instead of through addDemoProject (which switches mode).
      await page.getByRole('button', { name: 'New project' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New project' });
      await dialog.getByRole('button', { name: 'Browse' }).click();
      await dialog.getByRole('button', { name: 'Create project' }).click();
      await expect(page.locator('app-project-list .as-row__title')).toContainText('demo-project', { timeout: 10_000 });
      // A Provider is enabled, so New terminal asks which; the Hook is posted by hand into a plain shell.
      await page.getByRole('navigation', { name: /^Tabs of / }).getByRole('button', { name: 'New tab' }).click();
      await page.getByRole('listbox', { name: 'New tab' }).getByRole('option', { name: 'Shell' }).click();
      await expect(page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
      const badge = timmy.activity(0);
      await expect(badge).toHaveAttribute('data-activity', 'Idle', { timeout: 15_000 });

      await send({ hook_event_name: 'UserPromptSubmit' });
      await expect(badge).toHaveAttribute('data-activity', 'Active');
      // The CLI is quiet while it thinks: the output tap would say Idle by now, the Hook still says Working.
      await page.waitForTimeout(3500);
      await expect(badge).toHaveAttribute('data-activity', 'Active');
      await timmy.shot('hooks-terminal-working', { maskActivity: false, mask: [page.locator('.xterm-screen'), page.locator('app-terminal-screen header')] });

      await send({ hook_event_name: 'Notification', notification_type: 'permission_prompt' });
      await expect(badge).toHaveAttribute('data-activity', 'NeedsAttention');
      await timmy.shot('hooks-terminal-waiting', { maskActivity: false, mask: [page.locator('.xterm-screen'), page.locator('app-terminal-screen header')] });

      await send({ hook_event_name: 'Stop' });
      await expect(badge).toHaveAttribute('data-activity', 'Idle');
      await timmy.shot('hooks-terminal-done', { maskActivity: false, mask: [page.locator('.xterm-screen'), page.locator('app-terminal-screen header')] });
    } finally {
      rmSync(scripts, { recursive: true, force: true });
    }
  });
});
