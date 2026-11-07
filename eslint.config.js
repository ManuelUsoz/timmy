// Guardrail for the project's mechanical rules (see AGENTS.md / CODING_STANDARDS.md).
// Not a style pass: only the rules below are on. Each message states what to use instead.
const tseslint = require('typescript-eslint');

const TESTS = ['**/*.spec.ts', '**/*-fakes.ts'];

// Edge files that may run effects with the global `Effect.run*` functions.
const RUNTIME_EDGE = ['src/app/core/effect-runtime.ts', 'electron/rpc/runtime.ts'];

// Intentional composition roots, not re-export barrels.
const MERGE_POINTS = ['electron/ipc/index.ts', 'electron/rpc/index.ts'];

const syntax = {
  newError: {
    selector: "NewExpression[callee.name='Error']",
    message: 'Define a Schema.TaggedError with `reason` + `detail`, or turn a non-actionable failure into a defect (Effect.die / toWireDefect).',
  },
  throwStatement: {
    selector: 'ThrowStatement',
    message: 'Fail with a Schema.TaggedError (`return yield* new XError(...)`) or Effect.die; wrap throwing APIs in Effect.try / Effect.tryPromise.',
  },
  tagProbe: {
    selector: "BinaryExpression[operator='in'][left.value='_tag']",
    message: 'Match errors by tag with Effect.catchTag / Effect.catchTags (or Predicate.isTagged for a known tag).',
  },
  sendSync: {
    selector: "MemberExpression[property.name='sendSync']",
    message: 'Synchronous IPC blocks the renderer. Use invoke/handle or the RPC MessagePort.',
  },
  messageField: {
    selector:
      "CallExpression[callee.callee.object.name='Schema'][callee.callee.property.name='TaggedError'] > ObjectExpression > Property[key.name='message']",
    message: 'Name the field `detail` (and categorise with `reason`): `message` shadows Error.prototype.message and breaks Equal/Hash.',
  },
  arrowGen: {
    selector: "ArrowFunctionExpression > CallExpression.body[callee.object.name='Effect'][callee.property.name='gen']",
    message: 'Use Effect.fn("Domain.method")(function* (...) {}) or Effect.fnUntraced(function* (...) {}) instead of an arrow returning Effect.gen.',
  },
  barrel: {
    selector: 'Program',
    message: 'No barrel index.ts files: import from the defining module.',
  },
};

const v3Names = [
  { object: 'Context', property: 'Tag', message: 'Effect 4: use Context.Service.' },
  { object: 'Effect', property: 'Service', message: 'Effect 4: use Context.Service.' },
  { object: 'Schema', property: 'TaggedErrorClass', message: 'Effect 4: use Schema.TaggedError.' },
  { object: 'Layer', property: 'scoped', message: 'Effect 4: use Layer.effect(Tag, effect).' },
  { object: 'Layer', property: 'unwrapScoped', message: 'Effect 4: use Layer.unwrap.' },
  { object: 'Effect', property: 'catchAll', message: 'Effect 4: use Effect.catch.' },
  { object: 'Effect', property: 'either', message: 'Effect 4: use Effect.result.' },
];

const runAtEdge = 'Run effects at the edge: EffectRuntime.run in Angular, MainRuntime in main, it.effect in tests.';
const effectRuns = ['runPromise', 'runPromiseExit', 'runSync', 'runSyncExit', 'runFork', 'runCallback'].map((property) => ({
  object: 'Effect',
  property,
  message: runAtEdge,
}));

const restrictedImports = {
  paths: [
    { name: 'effect', importNames: ['ServiceMap'], message: 'Effect 4: use Context.Service.' },
    { name: 'effect', importNames: ['Mailbox'], message: 'Effect 4: use Queue.' },
  ],
  patterns: [
    {
      group: ['@effect/*', '!@effect/vitest'],
      message: 'Import from `effect`, `effect/rpc` or `effect/reactivity` (FileSystem / Path come from `effect`). Only @effect/vitest is allowed.',
    },
    { group: ['effect/unstable/*'], message: 'effect/unstable is a different API line. Import from `effect`, `effect/rpc` or `effect/reactivity`.' },
    { group: ['@effect-atom/*'], message: 'Use `effect/reactivity`.' },
  ],
};

const appSyntax = [syntax.newError, syntax.throwStatement, syntax.tagProbe, syntax.sendSync, syntax.messageField, syntax.arrowGen];
const testSyntax = [syntax.tagProbe, syntax.sendSync, syntax.messageField];

module.exports = tseslint.config(
  // Only application code is linted: src/ and electron/.
  { ignores: ['**/*', '!src/', '!src/**', '!electron/', '!electron/**'] },
  {
    files: ['src/**/*.ts', 'electron/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-syntax': ['error', ...appSyntax],
      'no-restricted-properties': ['error', ...v3Names, ...effectRuns],
      'no-restricted-imports': ['error', restrictedImports],
    },
  },
  {
    files: TESTS,
    rules: {
      'no-restricted-syntax': ['error', ...testSyntax],
      'no-restricted-properties': ['error', ...v3Names],
    },
  },
  {
    files: RUNTIME_EDGE,
    rules: { 'no-restricted-properties': ['error', ...v3Names] },
  },
  {
    files: ['src/**/index.ts', 'electron/**/index.ts'],
    ignores: MERGE_POINTS,
    rules: { 'no-restricted-syntax': ['error', ...appSyntax, syntax.barrel] },
  },
  {
    // The renderer reaches the main process only through DesktopApi.
    files: ['src/**/*.ts'],
    ignores: ['src/app/core/desktop-port.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...restrictedImports,
          paths: [...restrictedImports.paths, { name: 'electron', message: 'The renderer talks to main through DesktopApi (src/app/core/desktop-api.ts).' }],
        },
      ],
      'no-restricted-properties': ['error', ...v3Names, ...effectRuns, { object: 'window', property: 'desktop', message: 'Depend on DesktopApi; only src/app/core/desktop-port.ts touches window.desktop.' }],
    },
  },
  {
    // Re-apply the test and edge exemptions on top of the renderer block above.
    files: ['src/**/*.spec.ts', 'src/**/*-fakes.ts', 'src/app/core/effect-runtime.ts'],
    rules: { 'no-restricted-properties': ['error', ...v3Names, { object: 'window', property: 'desktop', message: 'Depend on DesktopApi.' }] },
  },
);
