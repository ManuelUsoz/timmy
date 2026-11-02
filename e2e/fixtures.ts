import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  ) {}

  bounds() {
    return this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  }

  isMaximized() {
    return this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
  }

  /** Waits for window-size animations to finish before a screenshot. */
  settle(ms = 450) {
    return this.page.waitForTimeout(ms);
  }

  async switchMode(mode: 'Pill' | 'Panel' | 'Expanded') {
    // In the Pill the switcher button goes straight to the Panel: there is no menu to pick from.
    const fromPill = (await this.page.locator('.pill-bar').count()) > 0;
    await this.page.getByRole('button', { name: 'Change window mode' }).last().click();
    if (!(fromPill && mode === 'Panel')) await this.page.getByRole('option', { name: mode }).click();
    await this.settle(900);
  }

  async openPanel() {
    await this.switchMode('Panel');
    await this.page.getByPlaceholder('Message Claude').waitFor();
  }

  composer() {
    return this.page.getByPlaceholder('Message Claude');
  }

  async send(text: string) {
    await this.composer().fill(text);
    await this.page.getByRole('button', { name: 'Send' }).click();
  }

  text(s: string | RegExp, timeout = 8000) {
    return this.page.getByText(s).first().waitFor({ timeout });
  }

  /** No view of the app scrolls sideways: the page fits the window and nothing in the composer bar sticks out. */
  async expectNoHorizontalOverflow() {
    const overflow = await this.page.evaluate(() => {
      const width = window.innerWidth;
      const doc = document.documentElement;
      const out: string[] = [];
      if (doc.scrollWidth > doc.clientWidth) out.push(`page scrolls: ${doc.scrollWidth} > ${doc.clientWidth}`);
      // What the user sees: a container whose content is wider than it and that shows a horizontal scrollbar.
      // (The session chip strip scrolls too, but without a visible bar.)
      for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
        const barHeight = el.offsetHeight - el.clientHeight - (el.offsetHeight - el.getBoundingClientRect().height);
        if (el.scrollWidth > el.clientWidth && barHeight >= 6) {
          out.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> scrolls sideways: ${el.scrollWidth} > ${el.clientWidth} (window ${width})`);
        }
      }
      return out.slice(0, 8);
    });
    expect(overflow, 'horizontal overflow').toEqual([]);
  }

  /** Visual regression check of the whole window. `name` is the baseline file name (`<name>.png`). */
  async shot(name: string, options: { mask?: ReturnType<Page['locator']>[] } = {}) {
    await this.settle();
    await this.expectNoHorizontalOverflow();
    await expect(this.page).toHaveScreenshot(`${name}.png`, options);
  }
}

export type Language = 'es' | 'en';

/** `test.use({ language: 'en' })` in a spec file pins the UI language; the default is the app's own (es). */
export const test = base.extend<{ timmy: Timmy; language: Language }>({
  language: ['es', { option: true }],
  timmy: async ({ language }, use) => {
    mkdirSync(fixtureCwd, { recursive: true });
    const userData = mkdtempSync(path.join(tmpdir(), 'timmy-e2e-'));
    writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ language }));
    const app = await electron.launch({
      executablePath: electronPath,
      args: [root],
      cwd: fixtureCwd,
      env: { ...process.env, TIMMY_E2E: '1', TIMMY_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForSelector('.pill-bar', { timeout: 20_000 });
    await page.waitForTimeout(800);

    await use(new Timmy(app, page));

    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    expect(errors, 'renderer console errors').toEqual([]);
  },
});

export { expect };
