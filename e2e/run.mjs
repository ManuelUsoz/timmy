// End-to-end UX harness: builds the app, launches the real Electron window against the mock
// chat adapter (TIMMY_E2E=1), drives it through scenarios and saves a screenshot of every state.
//
//   npm run e2e                       build + run every scenario
//   npm run e2e -- --no-build         reuse the last build
//   npm run e2e -- --only permission  run scenarios whose name contains "permission"
//
// Output (e2e-output/, gitignored): NN-<name>.png per shot, report.md, report.json.
// Agents: read report.md, then open the PNGs and judge the UX against what the change intended.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { scenarios } from './scenarios.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'e2e-output');
const fixtureCwd = path.join(root, 'e2e', 'fixture', 'timmy-demo');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;

if (!args.includes('--no-build')) {
  const build = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(fixtureCwd, { recursive: true });

const electronPath = createRequire(path.join(root, 'package.json'))('electron');
const report = [];
let shotCount = 0;

const settle = (page, ms = 450) => page.waitForTimeout(ms);

async function runScenario(scenario) {
  const userData = mkdtempSync(path.join(tmpdir(), 'timmy-e2e-'));
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: fixtureCwd,
    env: { ...process.env, TIMMY_E2E: '1', TIMMY_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const result = { name: scenario.name, intent: scenario.intent, shots: [], checks: [], ok: true };
  const t = {
    page,
    app,
    settle: (ms) => settle(page, ms),
    /** Saves a screenshot. `look` says what a reviewer should see in it. */
    async shot(name, look) {
      await settle(page);
      const file = `${String(++shotCount).padStart(2, '0')}-${scenario.name}-${name}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      result.shots.push({ file, look });
    },
    /** A named assertion; a failure is recorded and the scenario stops. */
    async check(label, fn) {
      try {
        await fn();
        result.checks.push({ label, ok: true });
      } catch (e) {
        result.checks.push({ label, ok: false, error: String(e.message ?? e).split('\n')[0] });
        throw e;
      }
    },
    bounds: () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()),
    async openPanel() {
      await this.switchMode('Panel');
      await page.getByPlaceholder('Message Claude').waitFor();
    },
    async send(text) {
      await page.getByPlaceholder('Message Claude').fill(text);
      await page.getByRole('button', { name: 'Send' }).click();
    },
    async switchMode(mode) {
      // In the Pill the switcher button goes straight to the Panel: there is no menu to pick from.
      const fromPill = (await page.locator('.pill-bar').count()) > 0;
      await page.getByRole('button', { name: 'Change window mode' }).last().click();
      if (!(fromPill && mode === 'Panel')) await page.getByRole('option', { name: mode }).click();
      await settle(page, 900);
    },
    text: (s, timeout = 8000) => page.getByText(s).first().waitFor({ timeout }),
  };

  try {
    await page.waitForSelector('.pill-bar', { timeout: 20000 });
    await settle(page, 800);
    await scenario.run(t);
  } catch (e) {
    result.ok = false;
    result.error = String(e.message ?? e).split('\n')[0];
    try {
      await t.shot('FAILED', 'State of the window when the scenario failed.');
    } catch {}
  }
  if (consoleErrors.length > 0) result.consoleErrors = consoleErrors;
  await app.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
  return result;
}

for (const scenario of scenarios.filter((s) => !only || s.name.includes(only))) {
  console.log(`> ${scenario.name}`);
  const result = await runScenario(scenario);
  console.log(`  ${result.ok ? 'PASS' : 'FAIL'}${result.error ? `: ${result.error}` : ''}`);
  report.push(result);
}

const lines = ['# Timmy e2e report', ''];
for (const r of report) {
  lines.push(`## ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, '', `Intent: ${r.intent}`, '');
  if (r.error) lines.push(`**Error:** ${r.error}`, '');
  for (const c of r.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label}${c.error ? ` — ${c.error}` : ''}`);
  if (r.consoleErrors) lines.push('', 'Console errors:', ...r.consoleErrors.map((e) => `- ${e}`));
  lines.push('');
  for (const s of r.shots) lines.push(`- \`${s.file}\` — look for: ${s.look}`);
  lines.push('');
}
writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

const failed = report.filter((r) => !r.ok).length;
console.log(`\n${report.length - failed}/${report.length} scenarios passed. Screenshots + report: ${outDir}`);
process.exit(failed === 0 ? 0 : 1);
