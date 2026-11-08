import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const fixtureCwd = path.join(root, 'e2e', 'fixture', 'timmy-demo');
const electronPath: string = createRequire(path.join(root, 'package.json'))('electron');

/** Helpers shared by every spec. Mirrors the old `t` object of the pre-Playwright-test harness. */
export class Timmy {
  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    /** The app data directory of this run; Claude Code settings for the Hook live in claude/ inside it. */
    readonly userData: string,
    /** The folder the demo project is added from: a git repository of its own, empty until a spec writes into it. */
    readonly projectDir: string,
  ) {}

  bounds() {
    return this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  }

  /**
   * Puts the cursor Timmy sees at `point` on the desktop. The e2e app ignores the real cursor, which would move the Mascot's
   * eyes in every screenshot; until a spec calls this, no cursor position is reported.
   */
  moveCursor(point: { x: number; y: number }) {
    return this.app.evaluate((_, p) => {
      (globalThis as { timmyE2eCursor?: { x: number; y: number } }).timmyE2eCursor = p;
    }, point);
  }

  /** The center of a locator on the desktop: the window's origin plus its place in the page. */
  async desktopCenter(locator: ReturnType<Page['locator']>) {
    const [window, box] = await Promise.all([this.bounds(), locator.boundingBox()]);
    return { x: window.x + box!.x + box!.width / 2, y: window.y + box!.y + box!.height / 2 };
  }

  isMaximized() {
    return this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
  }

  /** Waits for window-size animations to finish before a screenshot. */
  settle(ms = 450) {
    return this.page.waitForTimeout(ms);
  }

  async switchMode(mode: 'Pill' | 'Panel' | 'Expanded') {
    // In the Pill the switcher button goes straight to the Panel: there is no menu to pick from, so Expanded goes through the Panel.
    if ((await this.page.locator('.pill-bar').count()) > 0) {
      await this.page.getByRole('button', { name: 'Change window mode' }).last().click();
      await this.settle(900);
      if (mode === 'Panel') return;
    }
    await this.page.getByRole('button', { name: 'Change window mode' }).last().click();
    await this.page.getByRole('option', { name: mode }).click();
    await this.settle(900);
  }

  async openPanel() {
    await this.switchMode('Panel');
    await this.page.getByRole('region', { name: 'Timmy panel' }).waitFor();
  }

  /** Adds the demo project in the Workspace. Leaves the Window in Expanded with the project open. */
  async addDemoProject() {
    await this.switchMode('Expanded');
    await this.page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = this.page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('button', { name: 'Browse' }).click();
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(this.page.locator('app-project-list .as-row__title')).toContainText('demo-project', { timeout: 10_000 });
  }

  /** Adds the demo project and opens a real terminal in it. Leaves the Window in Expanded. */
  async openProjectTerminal() {
    await this.addDemoProject();
    await this.newTerminal();
  }

  /** "New tab" of the Project that is open in the Workspace: a Terminal in a Tab of its own. */
  async newTerminal() {
    await this.page.getByRole('navigation', { name: /^Tabs of / }).getByRole('button', { name: 'New tab' }).click();
    await expect(this.page.locator('.xterm-screen')).toContainText('PS ', { timeout: 15_000 });
  }

  text(s: string | RegExp, timeout = 8000) {
    return this.page.getByText(s).first().waitFor({ timeout });
  }

  /** No view of the app scrolls sideways: the page fits the window and nothing sticks out. */
  async expectNoHorizontalOverflow() {
    const overflow = await this.page.evaluate(() => {
      const width = window.innerWidth;
      const doc = document.documentElement;
      const out: string[] = [];
      if (doc.scrollWidth > doc.clientWidth) out.push(`page scrolls: ${doc.scrollWidth} > ${doc.clientWidth}`);
      // What the user sees: a container whose content is wider than it and that shows a horizontal scrollbar.
      // (The chip strip scrolls too, but without a visible bar.) A code viewer scrolls sideways by design, and says so
      // with `data-scrolls-x`.
      for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
        if (el.hasAttribute('data-scrolls-x')) continue;
        const barHeight = el.offsetHeight - el.clientHeight - (el.offsetHeight - el.getBoundingClientRect().height);
        if (el.scrollWidth > el.clientWidth && barHeight >= 6) {
          out.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> scrolls sideways: ${el.scrollWidth} > ${el.clientWidth} (window ${width})`);
        }
      }
      return out.slice(0, 8);
    });
    expect(overflow, 'horizontal overflow').toEqual([]);
  }

  /**
   * Visual regression check of the whole window. `name` is the baseline file name (`<name>.png`).
   * The activity badge of a Terminal row (Active, Idle) follows the clock, so it is masked unless `maskActivity` is false.
   */
  async shot(name: string, options: { mask?: ReturnType<Page['locator']>[]; maskActivity?: boolean } = {}) {
    await this.settle();
    await this.expectNoHorizontalOverflow();
    const { maskActivity = true, mask = [] } = options;
    await expect(this.page).toHaveScreenshot(`${name}.png`, { mask: maskActivity ? [...mask, this.page.locator('[data-activity]')] : mask });
  }

  /** The activity badge of the n-th View header (0-based) of the Tab on screen. */
  activity(n: number) {
    return this.page.locator('app-pane-stack .view-header [data-activity]').nth(n);
  }

  /** Types a command into the open Terminal and runs it. */
  async run(command: string) {
    await this.page.locator('.xterm-helper-textarea').focus();
    await this.page.keyboard.type(command);
    await this.page.keyboard.press('Enter');
  }
}

export type Language = 'es' | 'en';
export type Provider = 'OpenCode' | 'ClaudeCode' | 'Codex';

/** What the stand-in CLI prints. A spec waits for it to know the Provider's command ran. */
export const STAND_IN_OUTPUT = 'stand-in claude ran';

/** A directory with a `claude` command that prints STAND_IN_OUTPUT and exits: stands in for the real Claude Code CLI. */
const makeStandInBin = (): string => {
  const bin = mkdtempSync(path.join(tmpdir(), 'timmy-e2e-bin-'));
  if (process.platform === 'win32') {
    writeFileSync(path.join(bin, 'claude.cmd'), `@echo ${STAND_IN_OUTPUT}
`);
  } else {
    const file = path.join(bin, 'claude');
    writeFileSync(file, `#!/bin/sh
echo '${STAND_IN_OUTPUT}'
`);
    chmodSync(file, 0o755);
  }
  return bin;
};

/** The environment with `bin` first on PATH (spelled `Path` on Windows). */
const envWithPathFirst = (bin: string): NodeJS.ProcessEnv => {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...process.env, [key]: `${bin}${path.delimiter}${process.env[key] ?? ''}` };
};

/** `test.use({ language: 'en' })` in a spec file pins the UI language; the default is the app's own (es). */
export const test = base.extend<{ timmy: Timmy; language: Language; providers: Provider[] }>({
  language: ['es', { option: true }],
  /** `test.use({ providers: ['ClaudeCode'] })` enables those Providers in Settings from the start. */
  providers: [[], { option: true }],
  timmy: async ({ language, providers }, use) => {
    mkdirSync(fixtureCwd, { recursive: true });
    const userData = mkdtempSync(path.join(tmpdir(), 'timmy-e2e-'));
    writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ language, providers }));
    const standInBin = makeStandInBin();
    // The folder the (undrivable) native picker "chooses" when a spec adds a project: a git repository of its own.
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'timmy-e2e-project-'));
    const projectDir = path.join(projectRoot, 'demo-project');
    mkdirSync(projectDir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: projectDir });
    const app = await electron.launch({
      executablePath: electronPath,
      args: [root],
      cwd: fixtureCwd,
      env: { ...envWithPathFirst(standInBin), TIMMY_E2E: '1', TIMMY_E2E_PICK_FOLDER: projectDir, TIMMY_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForSelector('.pill-bar', { timeout: 20_000 });
    await page.waitForTimeout(800);

    await use(new Timmy(app, page, userData, projectDir));

    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(standInBin, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    expect(errors, 'renderer console errors').toEqual([]);
  },
});

export { expect };
