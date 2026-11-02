import { defineConfig } from '@playwright/test';

// Electron e2e + visual regression. Baselines live next to each spec in <spec>-snapshots/.
// `npm run e2e` builds and runs; `npm run e2e:update` regenerates the baselines.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'e2e-output/results',
  // Each test launches its own Electron with a private userData dir, so tests are independent,
  // but windows are real and positioned on the desktop: keep it serial to avoid overlap.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  snapshotPathTemplate: '{testDir}/{testFileDir}/__screenshots__/{testFileName}/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: 'e2e-output/report', open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
