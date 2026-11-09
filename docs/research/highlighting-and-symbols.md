# Highlighting and symbols under the CSP

Research for issue #165 (parent map #159). Question: syntax highlighting and a symbol breadcrumb
(`HandshakeService > connect()`) in the reader, in the Angular renderer, under the app's CSP, with a dark and a light
theme and files up to 1 MB (`MAX_PREVIEW_BYTES = 1_048_576`).

Date of the research: 2026-11-09. Versions: shiki 4.6.0, highlight.js 11.12.0, prismjs 1.30.0, CodeMirror
`@codemirror/view` 6.43.15 / `@codemirror/language` 6.13.1, `@lezer/highlight` 1.2.5, web-tree-sitter 0.27.2 (and 0.25.10),
`@vscode/tree-sitter-wasm` 0.3.1, typescript 6.0.3 and 7.0.2. Nothing in the repo was changed; all measurements come from a
throwaway install outside it.

## Summary

- **Lightest highlighting that covers the job: highlight.js**, core plus one lazily imported chunk per language
  (core 8.6 KB gzip; TypeScript adds 2.7 KB gzip; the 36-language `common` set is 54 KB gzip). No eval, no wasm, no remote
  loading, about 0.3 s per MB on the main thread, runs in a worker, and it themes with plain CSS classes. Prism is a few KB
  lighter but is in security-only maintenance.
- **CSP**: the current CSP (`script-src 'self'`, no `'wasm-unsafe-eval'`) blocks every wasm-based option on the page
  (Shiki's Oniguruma engine, tree-sitter). Verified in the real Electron binary. Everything that is plain JS (highlight.js, Prism,
  Lezer, CodeMirror, Shiki's JavaScript engine, the TypeScript compiler) runs under it unchanged.
- **The breadcrumb needs a parser, which none of the three lightest highlighters has.** Cheapest real parser: **Lezer**,
  about +47 KB gzip for TypeScript/JavaScript (+131 KB minified), lazy, with symbol lookup measured at about 6 microseconds. Lezer
  could also do the highlighting for the languages it has a grammar for at zero extra parse cost, so the end state is probably
  "Lezer where there is a grammar, highlight.js for the long tail".
- **Shiki is the heaviest and the slowest** on a 1 MB file (about 3 s with its JavaScript engine, 1 to 2.5 s with wasm), and its
  best engine needs a CSP change. **The TypeScript compiler API is not a good fit**: 3.6 MB minified (1.0 MB gzip) in the
  renderer, JS/TS only, and TypeScript 7 ships no JS API.

## Context in this repo

- The CSP lives in a `<meta>` tag in `src/index.html`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self' ws://localhost:4200;`. There is no `worker-src`, so workers fall back to `script-src` then `default-src`
  ([MDN worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)).
  There is no `'unsafe-eval'` and no `'wasm-unsafe-eval'`. `style-src` allows `'unsafe-inline'`, so inline `style=""` and
  injected `<style>` elements are fine.
- Production loads `dist/renderer/index.html` with `loadFile` (`electron/main.ts`), i.e. `file://`. Electron's own docs say a
  CSP header cannot be used for `file://` resources, hence the meta tag
  ([Electron security](https://www.electronjs.org/docs/latest/tutorial/security)). Dev loads `http://localhost:4200`.
- The window uses `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Today the reader is `<pre class="gutter">` plus `<pre class="source">{{ file.content }}</pre>` in
  `files-sidebar.html`, with a computed gutter. Later slices need per-line addressing (line selection and mention, #155) and
  Ln/Col, so highlighted output must keep one line per line and the same metrics as the plain `<pre>`.
- The app's tokens (`src/styles.css`) are Carbon-style (`--text-primary`, `--link`, `--support-*`, `--tag-*`) with a dark default and
  `[data-theme='white']` overrides. There are no syntax colours yet: any option needs a new small set of tokens (for example
  `--syntax-keyword`, `-string`, `-comment`, `-number`, `-function`, `-type`, `-punctuation`, defined once per theme).
- Angular's `initial` bundle budget is warn 500 kB / error 1.25 MB (`angular.json`). Dynamic `import()` chunks are not initial, so
  a lazily loaded highlighter and per-language chunks do not touch it.

## How the numbers were obtained

- Bundle weight: esbuild 0.28.2, `--bundle --minify --format=esm`, browser platform, entry importing only what is named. gzip is
  `GZipStream` Optimal. "min" is minified bytes. Wasm sizes are the files on disk and gzip of the file.
- Speed: Node 24.22 on this Windows 11 laptop, one process, 3 runs per case, a 1 MB prefix cut at a line boundary of two inputs:
  `lib.dom.d.ts` (21,080 lines, declaration heavy) and the first MB of TypeScript's `typescript.js` (13,911 lines, dense code),
  both highlighted as TypeScript. Cold run first, then the next two. These are Node numbers, not Chromium, and noisy (the same
  run varied by up to 30 percent). Read them as orders of magnitude.
- CSP: a throwaway Electron app, outside the repo, run with the repo's own electron 45 binary, `sandbox: true`,
  `contextIsolation: true`, loading a `file://` page with a meta CSP identical to `src/index.html`, and a second page that
  adds only `'wasm-unsafe-eval'`.

## Bundle weight

All figures are for code shipped to the renderer. "Chunk" means it can be a lazy `import()`.

| Option | What was bundled | min | gzip |
| --- | --- | --- | --- |
| Prism | core + clike + javascript + typescript | 15.0 KB | 5.7 KB |
| Prism | core + typescript + json + markdown | 26.8 KB | 9.6 KB |
| highlight.js | `lib/core` only | 21.3 KB | 8.6 KB |
| highlight.js | core + typescript | 29.1 KB | 11.3 KB |
| highlight.js | core + ts, js, json, css, xml(html), markdown | 53.6 KB | 17.0 KB |
| highlight.js | `lib/common` (36 languages) | 164 KB | 54.3 KB |
| highlight.js | everything (`import 'highlight.js'`, 193 languages) | 1,090 KB | 315 KB |
| Lezer only (no CodeMirror view) | `@lezer/highlight` + `@lezer/javascript` (TS, TSX, JS, JSX) | 131.5 KB | 47.5 KB |
| Lezer only | 12 parsers: js/ts, css, html, json, markdown, python, rust, go, java, cpp, yaml, xml | 515 KB | 187 KB |
| CodeMirror 6 | state + view + language (the minimum to use `StreamLanguage`, `syntaxHighlighting`, `matchFilename`) | 240 KB | 78.4 KB |
| CodeMirror 6 | above + `@codemirror/lang-javascript` | 362 KB | 123 KB |
| CodeMirror 6 | state + view + 5 language packs (js, json, css, html, markdown) + `lineNumbers` | 485 KB | 168 KB |
| CodeMirror 6 | `@codemirror/language-data` (143 languages, 124 lazy files; entry 16 KB) | 1,538 KB total | 568 KB total |
| Shiki | `shiki/core` + JavaScript engine, no language | 166 KB | 54.4 KB |
| Shiki | above + TypeScript grammar | 347 KB | 70.4 KB |
| Shiki | core + JS engine + css-variables theme + 6 grammars (ts, js, json, css, html, markdown), 10 chunks | 700 KB total (entry 171 KB) | 119 KB total |
| Shiki | Oniguruma engine + 1 grammar | 512 KB total JS | 213 KB (incl. inlined wasm, see below) |
| Shiki | Oniguruma wasm file (`shiki/wasm`, `onig.wasm`) | 467 KB | 149 KB |
| web-tree-sitter 0.27 | JS glue | 76 KB | 20 KB |
| web-tree-sitter 0.27 | runtime wasm | 211 KB | 83 KB |
| tree-sitter grammars (`tree-sitter-wasms` 0.1.13) | typescript / tsx / javascript / python / rust / go / css / json | 2.34 MB / 2.41 MB / 647 KB / 476 KB / 819 KB / 236 KB / 98 KB / 6 KB | 214 / 220 / 79 / 71 / 101 / 51 / 17 / 2.3 KB |
| tree-sitter grammars (`@vscode/tree-sitter-wasm` 0.3.1, what VS Code uses) | typescript / tsx / javascript / python / rust / css | 1.41 MB / 1.45 MB / 412 KB / 458 KB / 1.11 MB / 129 KB | not measured |
| TypeScript compiler (6.0.3, `import * as ts`) | whole `typescript.js` (9.1 MB raw) | 3,576 KB | 1,027 KB |
| TypeScript 7.0.2 | no JS API (see below) | n/a | n/a |

Language counts in each package (from the installed packages): Shiki 242 grammars (346 names counting aliases), highlight.js
193, Prism 400 names counting aliases, CodeMirror `language-data` 143 descriptions, Lezer 12 official grammars used
above (a few more exist, such as sass and wast).

Notes:

- Shiki's per-language cost is mostly the grammar JSON: the TypeScript grammar alone is 190 KB minified and compresses well
  (about +16 KB gzip). The `@shikijs/langs` package on disk is 8.6 MB raw for all 722 files, but the bundler only takes what
  is imported ([Shiki install: "all the themes and languages are bundled as async chunks"](https://shiki.style/guide/install)).
- The tree-sitter wasm file sizes are why it is the heaviest per language: a grammar is a compiled parser, not a table.
  The two builds differ by 40 percent for TypeScript (2.34 MB vs 1.41 MB).
- The TypeScript compiler cannot be tree-shaken (one 9 MB CommonJS file).

## CSP: eval, wasm, remote loading, workers

What the app's CSP permits, checked in Electron 45 on a `file://` page with the exact meta CSP:

| Check | Result under the app's CSP | With `'wasm-unsafe-eval'` added |
| --- | --- | --- |
| `eval('1')`, `new Function(...)` | blocked | blocked |
| `WebAssembly.compile` on the page | **blocked** | allowed |
| Shiki, JavaScript engine, on the page | works (output uses `var(--tok-*)` custom properties) | works |
| Shiki, Oniguruma wasm engine, on the page | **fails**: "Compiling or instantiating WebAssembly module violates ... 'unsafe-eval' is not an allowed source" | works |
| web-tree-sitter (VS Code build) `Parser.init`, `Language.load('...typescript.wasm')`, parse | **aborts** with the same CompileError | works, and resolved `class=HandshakeService method=connect` |
| `fetch('x.wasm')` and `XMLHttpRequest` of a relative file on `file://`, `connect-src 'self'` | works (HTTP 200, bytes read) | works |
| `new Worker('worker.js')` (a separate file next to the page) | works | works |
| `new Worker(blob:...)` | **blocked** ("script-src 'self'", `worker-src` not set so `script-src` is the fallback) | blocked |

Findings:

1. **Wasm needs a CSP change, and only that one.** `'wasm-unsafe-eval'` is the narrow source expression: it allows wasm
   compilation without allowing JavaScript `eval` ([MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)).
   The tree-sitter test ran with it and without `'unsafe-eval'`, so web-tree-sitter's two `eval(` call sites
   (`web-tree-sitter.js` around lines 2365 and 2388, in the loader for side modules with `EM_ASM`/`EM_JS` exports) were not
   reached for the VS Code grammar. A grammar built with such exports would hit them and need `'unsafe-eval'`; not tested.
2. **Pure-JS options need no CSP change.** A search of the shipped files for `eval(` / `new Function` found none in highlight.js
   core, Prism core, Shiki (core, both engines, textmate), the `@codemirror/*` and `@lezer/*` runtime, or typescript.js 6.0.3.
   Shiki's JavaScript engine turns grammar regexes into `RegExp` objects, which is not `eval` and ran fine
   ([Shiki regex engines](https://shiki.style/guide/regex-engines): "Transpiles Oniguruma patterns to native JavaScript regexes").
3. **CodeMirror and style injection.** CodeMirror injects its styles from JavaScript with style-mod
   ([CodeMirror guide](https://codemirror.net/docs/guide/)) and exposes `EditorView.cspNonce` for a nonce (declaration in
   `@codemirror/view/dist/index.d.ts`: "Provides a Content Security Policy nonce to use when creating the style sheets"). The
   app already allows `style-src 'unsafe-inline'`, so no nonce is needed. Not run in Electron (read from source only).
4. **Workers.** Build-time workers fit `'self'`: Angular's `new Worker(new URL('./x.worker', import.meta.url))` emits a
   separate file ([Angular web workers](https://angular.dev/ecosystem/web-workers)); blob workers do not. In the test, a
   `file://` worker file ran Shiki with both engines, **including the wasm one, on the page whose CSP forbids wasm**: the page's
   `<meta>` CSP did not follow into the `file://` worker (a worker script has no headers of its own to carry one). That is a
   quirk, not a guarantee; it would not hold if the app later serves the renderer through a custom protocol with real CSP
   headers, and dev (`http://localhost:4200`) was not tested. Do not design around it: if wasm is wanted, add
   `'wasm-unsafe-eval'`.
5. **Remote loading.** None of the options needs it when imported through npm. Things to avoid: highlight.js's documented CDN
   usage, Prism's autoloader plugin, tree-sitter grammars fetched from a CDN. The only network-like step is `fetch` of a bundled
   `.wasm` (tree-sitter), and it worked on `file://` with `connect-src 'self'`. Shiki's `shiki/wasm` import inlines the wasm
   instead of fetching it.
6. **Angular HTML binding.** If highlighted output is bound with `[innerHTML]`, Angular sanitizes it
   ([Angular security](https://angular.dev/best-practices/security)); that page does not say what happens to `style=""`
   attributes, so check before using Shiki's default inline-style HTML. Options that emit classes (highlight.js, Prism,
   Lezer with `classHighlighter`) avoid the question, and rendering tokens through a template avoids `innerHTML` entirely.

## Large files (up to 1 MB) and off the main thread

Tokenizing time on 1 MB, Node, first and later runs (milliseconds):

| Option | `lib.dom.d.ts` (21k lines) | `typescript.js` (14k lines) | Incremental | Off main thread |
| --- | --- | --- | --- | --- |
| Shiki, JavaScript engine | 3,700-4,500 cold, 2,700-3,500 later | 3,300-4,000 | by line chunks with `grammarState` (below), not by edit | yes: ran in a classic worker in Electron |
| Shiki, Oniguruma wasm | 830-1,300 | 2,400-2,800 | same | yes (ran in the worker) |
| highlight.js | 250-350 | 390-430 | no | documented ([highlight.js readme](https://highlightjs.readthedocs.io/en/latest/readme.html): a worker "to avoid freezing the browser window while dealing with very big chunks of code") |
| Prism | 250-370 | 420-450 | no | built in: core has a worker message handler (`Prism.disableWorkerMessageHandler`, `prism.js` line 69) |
| Lezer parse + `highlightTree` | 160-270 | 230-320 | yes: reuses cached nodes after an edit ([Lezer guide](https://lezer.codemirror.net/docs/guide/)); read-only reader does not need it | pure JS, no DOM, so yes |
| CodeMirror 6 | parses in 100 ms slices with idle callbacks on the main thread (`@codemirror/language`: `Work.Slice = 100`, `Work.MaxPause = 500`), renders only the viewport ([guide](https://codemirror.net/docs/guide/): "CodeMirror doesn't render the entire document, when that document is big") | same | yes | the parse is main thread by design |
| web-tree-sitter | 95-120 | 160-170 | yes (`tree.edit` then reparse: about 2 ms and 7 ms for a one-character edit here; my edit positions were approximate, so treat as an order of magnitude) | yes, wasm in a worker |
| TypeScript 6 `createSourceFile` | 75-150 | 100-135 | no | yes |

Per-option notes:

- **Shiki guards.** From the Shiki type declarations (`@shikijs/types`): `tokenizeMaxLineLength` ("Lines above this length will not be
  tokenized", default 0 = no limit), `tokenizeTimeLimit` ("Time limit in milliseconds for tokenizing a single line", default 500),
  and `grammarState` / `grammarContextCode` to start tokenizing in the middle with the state from an earlier chunk. So Shiki
  can be fed a chunk of lines at a time, but each chunk needs the state of the previous one; jumping to the middle of a file
  without tokenizing the top is only approximate (`grammarContextCode`). Minified one-line files are the case for the line guards.
  Its JavaScript engine needed the RegExp `v` flag for best results and is "strict by default" (it throws on a pattern it
  cannot convert; `forgiving: true` avoids that at the risk of mismatches) ([regex engines](https://shiki.style/guide/regex-engines)).
- **DOM cost is the other half.** Lezer produced about 51k to 123k styled runs for the two 1 MB samples; highlight.js emitted
  26k to 48k `<span>`s and 2.0 to 2.8 MB of HTML. Putting that in one `<pre>` is the real risk for a 1 MB file, more than the
  tokenizer. Mitigations that work with any option: render per line or per chunk of lines (also needed for line selection
  and Ln/Col), `content-visibility: auto` on chunks, or only highlight the lines near the viewport and the rest as plain
  text. Lezer's `highlightTree` yields `(from, to, classes)` ranges, so slicing by line range is direct.
- **Time is fine for all of them except Shiki**, if tokenizing runs in a worker or once on open: 0.2 to 0.4 s of main-thread
  block per 1 MB for highlight.js, Prism and Lezer is the worst case, and most files are 1 to 2 orders smaller
  (100 KB: Prism 25 ms, Lezer 27 ms, highlight.js 50 ms, Shiki about 210 ms).

## Language coverage by file name and extension

Only CodeMirror ships a file name matcher. `LanguageDescription.matchFilename(descs, filename)` "will first match filename
patterns, and then extensions" (declaration in `@codemirror/language/dist/index.d.ts`), so `Dockerfile` and `CMakeLists.txt`
resolve. The other libraries map by language name or alias; an app-owned table of extension and file name to language
name is needed (about 60 lines of data, and it is also where `.component.html` or `.mts` is decided).

A rough check of 75 realistic names (`a.ts`, `a.mts`, `a.tsx`, `a.jsonc`, `a.mdx`, `a.vue`, `a.svelte`, `Dockerfile`, `Makefile`,
`.gitignore`, `.env`, `a.proto`, `a.tf`, `a.zig`, `a.nix`, and so on). For the first three libraries the extension itself was used
as the alias, with no mapping table, so this understates what a table would reach. For CodeMirror, `matchFilename` was used.

| Option | Resolved of 75 | Typical misses |
| --- | --- | --- |
| Shiki (242 grammars) | 61 | `.htm`, `.svg`, `.h`, `.hpp`, `.env`, `.conf`, `.ex`, `.patch`, `.txt`, `.lock`, `.gitignore`, `.sol` |
| highlight.js (193) | 60 | `.mdx`, `.sass`, `.vue`, `.svelte`, `.tf`, `.zig`, `.wgsl`, `.htm`, `.env` |
| Prism | 52 | `.mts`/`.cts`/`.mjs`/`.cjs`, `.rs`, `.zsh`, `.ps1`, `.vue`, `.svelte`, `.proto`, `.tf` |
| CodeMirror `language-data` (143) | 53 | `.jsonc`, `.mdx`, `.zsh`, `.svelte`, `Makefile`, `.gitignore`, `.graphql`, `.tf`, `.zig`, `.nix`, `.bat` |

Take-aways: all four cover the mainstream set (TS, JS, JSON, CSS/SCSS, HTML, Markdown, YAML, TOML, Python, Rust, Go, Java, C/C++,
C#, Ruby, PHP, shell, SQL, Swift, Kotlin, Dart, Lua, Dockerfile). Shiki has the widest long tail, notably Vue, Svelte, Terraform,
Zig, Nix, WGSL. Lezer has only the dozen official grammars; the rest of CodeMirror's coverage comes from `@codemirror/legacy-modes`
stream parsers (token only, no tree, so no breadcrumb) via `StreamLanguage`, which brings the 240 KB min CodeMirror base along.

## Theming with the app's tokens

All the options can follow `[data-theme]` through CSS custom properties; none needs a second tokenizing pass for light vs dark.

- **highlight.js**: emits `<span class="hljs-keyword">`, `hljs-string`, and so on. Write one small stylesheet mapping those
  classes to `var(--syntax-*)`. The stock themes are hard-coded colours, so skip them.
- **Prism**: `token keyword`, `token string`, and so on. Same approach.
- **Lezer / CodeMirror**: `classHighlighter` gives `tok-keyword` classes; or `HighlightStyle.define([{ tag: tags.keyword, color:
  'var(--syntax-keyword)' }])`. Same approach.
- **Shiki**: the `css-variables` theme (`createCssVariablesTheme`) is built for this. Default prefix `--shiki-`, variables
  `--shiki-foreground`, `--shiki-background`, `--shiki-token-constant`, `-string`, `-comment`, `-keyword`, `-parameter`,
  `-function`, `-string-expression`, `-punctuation`, `-link`; the page notes "requires to define the CSS variables in your app"
  ([Shiki theme colors](https://shiki.style/guide/theme-colors)). Dark/light is then done in the app's CSS, as for the others.
  The prefix is configurable (the test used `--tok-`). Shiki's regular themes would have to be loaded twice (or use its
  dual-theme output) and do not read the app's tokens.
- **Tree-sitter**: gives node types; colours need a `highlights.scm` per language and a mapping to classes. `tree-sitter-wasms` and
  `@vscode/tree-sitter-wasm` ship only wasm, not the query files, so those would have to be vendored from each grammar repository.
- New tokens needed in `src/styles.css` for every option: about 8 to 10 `--syntax-*` variables, defined in `:root` and in
  `[data-theme='white']`, with checked contrast on `--background`, `--sidebar` and `--layer-*`.

## Symbol outline and the breadcrumb

| Option | Gives symbols? | How |
| --- | --- | --- |
| highlight.js, Prism | No | Token-level regexes, no nesting. |
| Shiki | Not directly | TextMate scopes per token (for example `entity.name.function`) are available, but scopes do not give containment; a breadcrumb would need brace matching. Not recommended. |
| Lezer / CodeMirror | **Yes**, for languages with a real Lezer grammar | Walk `syntaxTree`: `ClassDeclaration`, `FunctionDeclaration`, `MethodDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, `EnumDeclaration` for JS/TS; `ClassDefinition`, `FunctionDefinition` for Python. Legacy-mode (`StreamLanguage`) languages have no tree. |
| tree-sitter | **Yes**, any grammar | Walk nodes or run the grammar's `tags.scm` query (not shipped in the wasm packages). |
| TypeScript compiler | **Yes**, JS/TS only, with real semantics | `ts.createSourceFile`, `forEachChild`, `getNameOfDeclaration`. |

A prototype of the breadcrumb on Lezer (`@lezer/javascript`, TS dialect), run on a sample:

- Cursor inside `connect` resolves to `HandshakeService > connect()`.
- Cursor on a class field resolves to `HandshakeService`.
- Cursor in a top-level function resolves to `top()`.
- Cost on `lib.dom.d.ts` (1 MB): parse 250 ms (the same parse that highlighting needs), then 1,000 breadcrumb lookups in 5.7 ms
  (about 6 microseconds each, via `tree.resolveInner(pos, 1)` and walking `.parent`), and a full outline walk of 862
  declarations in 11 ms.
- Code needed: a table from node name to "which child holds the name" for each language (JS/TS about 8 entries, Python 2), and
  a lookup. Roughly 40 lines per language family. Anonymous arrow functions assigned to `const` need one more rule.

### The TypeScript compiler API option

- TypeScript 6.0.3 (what this repo pins, `~6.0.2`) still has the JS API: `createSourceFile` took 75 to 150 ms for 1 MB. But it
  is 3.6 MB minified (1.0 MB gzip) in the renderer, JS/TS only, and it is a dependency that today is dev-only.
- TypeScript 7.0 (July 2026) is the native port. The announcement says "TypeScript 7.0 ... does not ship with an API" and
  "We expect TypeScript 7.1 to ship with a new (and different) API"; a compatibility package `@typescript/typescript6`
  re-exports the 6.0 API ([Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
  The installed `typescript@7.0.2` has no `typescript.js`: it is a `tsc` launcher plus a platform binary, and an
  `unstable/sync` / `unstable/async` export that talks to that binary (package.json `exports`). That could run in main, not
  in the renderer.
- So a compiler-API breadcrumb is a main-process service over RPC with a moving target. Not worth it for the symbol of a file
  that Lezer can outline in the renderer.

## Options compared

| Criterion | Prism | highlight.js | Lezer (static) | CodeMirror 6 | Shiki | tree-sitter wasm | TS compiler |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bundle (TS only, gzip) | 5.7 KB | 11.3 KB | 47.5 KB | 123 KB | 70 KB (JS engine) | about 20 + 83 KB + grammar 214 KB | 1,027 KB |
| CSP as is | yes | yes | yes | yes (`unsafe-inline` styles) | JS engine yes; wasm no | no (`'wasm-unsafe-eval'`) | yes |
| 1 MB highlight time | 0.25-0.45 s | 0.25-0.43 s | 0.16-0.32 s | viewport only | 2.7-4.5 s JS engine; 0.8-2.8 s wasm | parse 0.1-0.17 s, plus a query pass | n/a |
| Off main thread | yes | yes | yes | no (sliced) | yes | yes | yes |
| File name matching | no | no | no (own table) | yes (`matchFilename`) | no | no | n/a |
| Breadcrumb | no | no | yes | yes (same Lezer trees) | no | yes | yes (TS/JS only) |
| Maintenance (npm `time.modified`) | 2026-09; v2 in development, "only accept security-relevant PRs" ([Prism README](https://github.com/PrismJS/prism)) | 2026-08 | 2026-09 | 2026-10 | 2026-11 | 2026-11 | 7.x without a JS API |

## Recommendation

**Highlighting: highlight.js, core plus a lazy chunk per language.**

- Lightest option that is well maintained and covers the job: 8.6 KB gzip core, 2.7 KB more for TypeScript, 17 KB gzip for six
  web languages, 54 KB gzip even for the 36-language `common` set, all in lazy chunks outside the 500 kB initial budget.
- No CSP change, no wasm, no eval; verified free of `eval(` and `new Function`.
- 0.25 to 0.43 s per 1 MB on the main thread, and a documented worker pattern for the worst case.
- Themes through class names mapped to about 8 to 10 new `--syntax-*` variables per theme. This also keeps the dark and
  light themes one stylesheet.
- Prism is about 5 KB gzip lighter but its maintainers are accepting only security PRs while v2 is built, and it misses more
  names (`.mts`, `.rs`). Not enough to prefer it.
- Needs an app-owned extension and file name table (no library does this except CodeMirror's), and per-line or per-chunk
  rendering so a 1 MB file does not become one 30,000-span `<pre>`. Both are needed for any option.

**Breadcrumb on top: Lezer, loaded lazily per language.**

- TypeScript/JavaScript: `@lezer/highlight` + `@lezer/javascript` is +131 KB min, +47.5 KB gzip, one lazy chunk loaded when a JS/TS
  file is opened. Python, Rust, Go, Java, C++, YAML, Markdown headings, and so on, are each a further lazy chunk of about
  10 to 60 KB gzip (the 12-parser set is 187 KB gzip in total).
- Time: one parse (about 0.2 to 0.3 s for the worst-case 1 MB, a few ms for a typical file; do it once on open, in a worker if it
  matters), then about 6 microseconds per cursor move. About 40 lines of code per language family.
- Languages with no Lezer grammar (shell, ruby, C#, SQL, toml, and so on) simply show the file path without symbols. Legacy
  stream parsers cannot give a tree.
- Because the Lezer parse is already paid for, highlighting those same languages from it (`highlightTree` with `classHighlighter`)
  adds no parse time and no second grammar, and the symbols and the colours cannot disagree. If the breadcrumb is in scope for the
  reader, the cheapest end state is Lezer for the languages it has, highlight.js for the long tail. Starting with highlight.js alone
  does not block that: it is a swap of one function per language.

**Not recommended:**

- Shiki: heaviest per language, 3 to 10 times slower on 1 MB, and the faster Oniguruma engine needs `'wasm-unsafe-eval'` added to
  the CSP. Its only edge is the long tail of grammars and TextMate fidelity.
- CodeMirror 6 as an embedded read-only editor: 123 to 168 KB gzip for a handful of languages and a second DOM and scroll model next
  to the existing gutter, line selection and Pane plumbing. Its parser is the Lezer used above, so take Lezer without the view.
- tree-sitter wasm: needs the CSP change, 1.4 to 2.3 MB per big grammar, and query files that are not packaged. Better
  fidelity and the best incremental story, but the weight is out of proportion for a read-only reader.
- TypeScript compiler API: see above.

## Open items and limits of this research

- Timings are Node 24 on one Windows machine, not Chromium in the packaged app; re-measure inside Electron when building.
- Not tested: the dev-server page (`http://localhost:4200`) with workers, an Angular build of a worker, CodeMirror under the CSP in
  Electron, a grammar with `EM_ASM` exports in web-tree-sitter, and the real light/dark colours (contrast has not been checked).
- The coverage table is a rough alias check, not a full extension audit. A real table of extensions should be written once and
  tested.
- Throwaway install and scripts live outside the repository; this file is the only artefact.
