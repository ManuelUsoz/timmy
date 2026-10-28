import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

const entryPoints = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' },
];

if (watch) {
  const contexts = await Promise.all(entryPoints.map((options) => context({ ...shared, ...options })));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('[electron] watching main + preload...');
} else {
  await Promise.all(entryPoints.map((options) => build({ ...shared, ...options })));
}
