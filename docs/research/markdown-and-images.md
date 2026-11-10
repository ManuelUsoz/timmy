# Rendering Markdown and images under the CSP

Research for issue #188 (parent map #159). Question: the file reader must show Markdown rendered and images, not only text,
in the Angular renderer, under the app's strict CSP, with main deciding what is read. Five parts: a Markdown renderer that runs
no HTML and loads nothing remote; how an image from a Project file reaches an `<img>`; SVG; the other formats a dev meets;
and relative links and images inside a README.

Date of the research: 2026-11-09. Versions: marked 18.2.0, markdown-it 15.0.3, micromark 4.0.3 with
micromark-extension-gfm 3.0.0, remark 15.0.1 with remark-gfm 4.0.1, DOMPurify 3.4.17, highlight.js 11.12.0, github-slugger 2.0.0,
markdown-it-task-lists 2.1.1, Electron 45.1.0 (Chromium 156.0.8078.49), Angular 22.2.3, Effect 4.0.7 (the repo's installed one),
Node 24.22. Nothing in the repo was changed; every measurement comes from a throwaway install and a throwaway Electron app outside it.

## Summary

- **Markdown: markdown-it with `html: true` plus DOMPurify on a strict allowlist, in one lazy chunk (52 KB gzip with DOMPurify).**
  It is the only one of the three that is fast and well behaved on hostile input: 1 MiB of real READMEs in about 0.1 s, and the
  worst inputs tried took at most 0.2 s, where marked needs 7 s for 200 KB of `a*` and micromark more than 15 s. It is safe by default
  (raw HTML is escaped, `javascript:` links are refused). marked (15 KB gzip, 26 KB with DOMPurify) is the cheap option and is already
  in `package.json` (`^18.1.3`, imported nowhere); it passes `<script>` and `javascript:` links through, goes quadratic and throws a stack
  overflow on some inputs, so it would need a worker with a time limit. micromark is the most spec-faithful but the slowest.
- **The current CSP already allows what images need.** `img-src 'self' data: blob:` is in `src/index.html` today. An image
  can reach the renderer as bytes over the existing RPC (`Uint8Array`, no base64), be wrapped in a `Blob` and shown through
  `URL.createObjectURL`. No CSP change, no custom protocol. The RPC frame limit is 16 MiB; a cap of 8 MiB per image leaves room.
- **A file size cap is not a memory cap.** A 1.1 MB PNG of 16000 x 16000 pixels decoded to about 310 MB of renderer memory. Main should read
  the pixel size from the header and refuse above a pixel budget.
- **SVG: show as `<img>` only, never inline, never `<iframe>`/`<object>`.** Verified in Electron 45: as `<img>` an SVG's script,
  `onload`, `<image>`, `@import`, `<use>`, `foreignObject` and `@font-face` made zero network requests, even on a page with no CSP at all; as
  `<iframe>` or `<object>` the scripts ran. What an `<img>` SVG can still do is burn CPU: a 1.1 KB SVG froze the renderer's main thread for
  13.7 s. Offer a text/image toggle and treat that freeze as an accepted residual risk.
- **Formats.** png, jpg, gif, webp, avif, ico, bmp and jxl display natively in Electron 45; tiff does not; svg needs an explicit
  `image/svg+xml`. PDF displays through Chromium's viewer but only if the CSP gains `frame-src blob:` and `object-src blob:`;
  recommended out of scope (open in the external viewer).
- **Two traps found on the way.** (1) The production page is `file://`, and `img-src 'self'` then lets any `<img src="file:///...">` load
  from anywhere on disk, so a README's image URLs must be rewritten, never passed through. (2) `will-navigate` in `electron/main.ts` allows
  every `file://` URL in production, so clicking a README link such as `docs/a.md` **navigates the whole app window away** (verified). Link clicks
  must be intercepted.
- **Relative links and images** need one pure resolver in the renderer (join to the README's folder, normalise, refuse escapes), main's existing
  `confine` as the real gate, one new read-only Files operation for image bytes, heading ids for `#anchors`, and a click handler. Costs and
  steps below. Most READMEs' images are remote (53 percent in a 629-README sample) and will show as alt text.

## Context in this repo

- The CSP is a `<meta>` tag in `src/index.html`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self' ws://localhost:4200;`. There is no `frame-src`, `object-src` or `worker-src`, so each falls back to `default-src 'self'`
  ([MDN CSP fetch directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)).
  Production loads `dist/renderer/index.html` through `loadFile`, i.e. `file://`; dev loads `http://localhost:4200`.
  `index.html` also has `<base href="./">`, so a relative URL in injected HTML resolves against the app bundle, not the Project.
- The Files RPC (`src/shared/files/files.rpc.ts`): `Files.list`, `Files.listDir`, `Files.read` (cwd plus relative `file`). `Files.read`
  returns `FileContent = text | binary | tooLarge`, with `MAX_PREVIEW_BYTES = 1_048_576`; it checks the size with `stat` **before** reading, so a big
  file never enters memory. A file that is not UTF-8, or has a NUL in its first 8 KB, is `binary` and its bytes are not returned: so an image today
  is just "binary".
- `electron/files/project-files.ts` has `confine(cwd, relative)`: refuses absolute paths, `..`, another drive and symlinks that lead out of the Project, comparing real
  paths. Every new read operation should go through it ("the renderer is untrusted").
- Wire: `layerPortSerialization = RpcSerialization.layerSchemaBinary()`, a `MessagePort` between renderer and main
  (`src/shared/rpc/message-port-protocol.ts`), `supportsTransferables: false`, a default frame limit of 16 MiB
  (`defaultSchemaBinaryMaxFrameSize` in `effect/dist/rpc/RpcSerialization.js`).
- `marked` `^18.1.3` is a dependency in `package.json` and nothing in `src/` or `electron/` imports it (grep).
- Navigation guards in `electron/main.ts`: `setWindowOpenHandler` opens only `https://` URLs externally and denies the rest;
  `will-navigate` is `if (!url.startsWith(DEV_SERVER_URL ?? 'file://')) event.preventDefault()`.
- Angular's `[innerHTML]` sanitizer (`@angular/core` `_debug_node-chunk.mjs`, `VALID_ELEMENTS`, `VALID_ATTRS`) has no `input`, no `id` and no `style`: task-list checkboxes, heading ids and table alignment `style=""` would be stripped from rendered
  Markdown. Its URL pattern is `/^(?!javascript:)(?:[a-z0-9+.-]+:|...)/i`, so it lets `blob:` and `data:` through. Bind Markdown with a
  DOMPurify-cleaned string through `bypassSecurityTrustHtml`, or render a token tree from a template, not `[innerHTML]` on raw output.
- The decided highlighter (#187) is highlight.js, lazy chunk per language, with the app's `--syntax-*` tokens.

## How the numbers were obtained

- Bundle weight: esbuild 0.28.2, `--bundle --minify --format=esm --platform=browser`, entry importing only what is named; gzip is zlib level 9.
  (The earlier highlighting research used the same method; its highlight.js core is 8.6 KB, mine 8.4 KB.)
- Rendering speed: Node 24 on one Windows 11 laptop, not Chromium. The "real" corpus is every `README.md` (depth up to 3) under the repo's
  `node_modules`: 629 files, the 1 MiB corpus is the largest ones concatenated up to 1 MiB, the biggest single file is 102 KB. These are npm
  package READMEs, not Project READMEs, so read the feature percentages as a proxy. Hostile inputs ran one per child process with a 15 s timeout.
- Electron: a throwaway app outside the repo, run with the repo's own electron 45.1.0 binary, `sandbox: true`, `contextIsolation: true`, a `file://`
  page whose `<meta>` CSP is identical to `src/index.html`, and a second page with no CSP as a control (to prove a test could see a leak). A local
  HTTP server on 127.0.0.1 counted any request an SVG or `<img>` made. A third and fourth page tested PDF; a fifth reproduced the navigation guards.

## Part 1: Markdown renderers

### Bundle weight

| Option | min | gzip |
| --- | --- | --- |
| marked (GFM built in) | 48.7 KB | 14.7 KB |
| markdown-it (default preset) | 97.3 KB | 40.7 KB |
| markdown-it + markdown-it-task-lists | 99.6 KB | 41.7 KB |
| micromark (CommonMark only) | 52.6 KB | 15.4 KB |
| micromark + micromark-extension-gfm | 73.2 KB | 21.0 KB |
| remark + remark-gfm + remark-rehype + rehype-stringify (mdast/hast pipeline) | 173.9 KB | 53.0 KB |
| DOMPurify | 30.4 KB | 11.8 KB |
| highlight.js core (for comparison) | 20.8 KB | 8.4 KB |
| marked + marked-highlight + hljs core + typescript | 78.7 KB | 26.4 KB |
| marked + DOMPurify | 79.4 KB | 26.3 KB |
| markdown-it + DOMPurify | 127.9 KB | 52.2 KB |
| micromark + gfm + DOMPurify | 104.1 KB | 32.7 KB |

All of it is a lazy chunk, outside Angular's 500 kB initial-bundle warning. markdown-it's weight is mostly the HTML entities table
and linkify-it.

### What each does with the same input (run, not read)

| Input | marked | markdown-it (defaults) | micromark + gfm |
| --- | --- | --- | --- |
| GFM table with `:-:` alignment | table, `align="center"` | table, inline `style="text-align:center"` | table, `align="center"` |
| `- [x] done` task list | `<input checked disabled type=checkbox>` | **not rendered** by default (plugin `markdown-it-task-lists`, last published 2022-06) | checkbox |
| `~~strike~~` | `<del>` | `<s>` | `<del>` |
| bare `https://example.com` | linked | linked only with `linkify: true` | linked |
| fenced code with a language | `<pre><code class="language-ts">` | same | same |
| raw `<script>alert(1)</script>` | **passed through** | escaped | escaped |
| raw `<img src=x onerror=...>` block | **passed through** | escaped | escaped |
| `[x](javascript:alert(1))` | **`href="javascript:alert(1)"`** | not a link, shown as text | `href=""` |
| `<!-- comment -->` | kept in output | shown as text | shown as text |
| footnotes `[^1]` | wrong (`<a href="note">`) | needs a plugin | rendered |
| `> [!NOTE]` alert | plain blockquote | plain blockquote | plain blockquote |
| `<p align="center"><img ...></p>` | passed through | **escaped, shown as literal text** | escaped, shown as literal text |
| heading `# Hello World` | no `id` | no `id` | no `id` |

Sources for the intent: marked's README: "Marked does not sanitize the output HTML. Please use a sanitize library, like DOMPurify
(recommended)" ([marked README](https://github.com/markedjs/marked)); micromark's `allowDangerousHtml` and `allowDangerousProtocol` both default to
`false` ([micromark readme](https://github.com/micromark/micromark)); markdown-it's `html` option is off by default and it validates link
schemes ([markdown-it docs](https://markdown-it.github.io/markdown-it/)). The table above is what the installed versions actually printed.

GitHub alerts (`> [!NOTE]`) and heading ids are not in any of the three; heading ids are a few lines in a markdown-it core rule plus
github-slugger 2.0.0 (8.6 KB minified, last published 2023-09), and alerts can be ignored (they stay a readable blockquote).

### Speed and hostile input (Node, ms)

Real READMEs:

| | marked | markdown-it | micromark + gfm |
| --- | --- | --- | --- |
| 1 MiB corpus, cold / warm | 145 / 80 | 129 / 74 | 1,012 / 948 |
| biggest README (102 KB) | 5 | 6 | 53 |

Hostile inputs, one input per child process, 15 s timeout. "n" is the repeat count: `a*` x n (2n chars), `[a](` x n/2, `> ` x n/5, `<a ` x n/2,
a table of n/20 rows. The nested-list rows are n/50 lines of growing indentation, about 170 KB at n=20,000 and about 4 MB at n=100,000
(past the 1 MiB cap; shown only for the shape of the growth).

| Input | n | marked | markdown-it | micromark + gfm |
| --- | --- | --- | --- | --- |
| `a*` repeated (emphasis) | 20,000 | 327 | 49 | 7,764 |
| | 100,000 | 7,262 | 149 | **> 15,000** |
| `[` repeated | 20,000 / 100,000 | 22 / 72 | 48 / 198 | 78 / 272 |
| `[a](` repeated | 20,000 / 100,000 | 25 / 75 | 18 / 52 | 206 / **> 15,000** |
| `> ` repeated (deep blockquote) | 20,000 / 100,000 | **RangeError: stack overflow** | 2 / 3 | 44 / 686 |
| nested list, growing indent | 20,000 / 100,000 | 461 / **> 15,000** | 7 / 23 | 1,292 / **> 15,000** |
| backticks repeated | 20,000 / 100,000 | 1 / 1 | 2 / 3 | 7 / 9 |
| table | 20,000 / 100,000 | 13 / 36 | 18 / 52 | 74 / 305 |
| `<a ` repeated | 20,000 / 100,000 | 19 / 58 | 10 / 22 | 71 / 243 |

markdown-it is flat on everything tried (I did not read its source to find out why).
marked and micromark are quadratic on emphasis, and marked also throws a catchable `RangeError` on deep nesting. The threat is a
hostile Markdown file in a cloned repo freezing the UI, not code execution. With marked or micromark the parse has to run in a Worker
with a timeout (`worker.terminate()`), and fall back to plain text; with markdown-it a size cap of `MAX_PREVIEW_BYTES` is enough.

### Fenced code with the highlighter

All three emit `<pre><code class="language-xyz">`. markdown-it has a synchronous `highlight(str, lang)` option that returns HTML; marked needs the
`marked-highlight` extension or a renderer override; micromark has no hook (post-process the HTML, or take the remark pipeline at 53 KB).
highlight.js output (`hljs.highlight(code, { language }).value`) is `<span class="hljs-...">` markup and needs only `class` on `span` to survive DOMPurify.
Language chunks load asynchronously (#187): scan the token stream (`md.parse(src, {})`) for `fence` tokens first, `await import()` the languages found,
then render, so `highlight` stays synchronous. Use #187's one extension/alias table for the fence info string. Per-line DOM is not needed inside a Markdown block.

### Sanitizing

READMEs use HTML a lot. In the 629-README sample (rough regexes): 17 percent contain `<img>`, 11 percent a `<p|div|h1|a align=...>`, 24 percent some HTML
block element at line start, 1 percent `<details>`. With `html: false` those blocks appear as literal escaped tags, which looks broken. With
`html: true` the output needs a sanitizer. DOMPurify 3.4.17 (maintained, last published 2026-10) in jsdom, default configuration:

| Input | Result |
| --- | --- |
| `<script>`, `<iframe>`, `<object>`, `<embed>` | removed |
| `onload=` on inline `<svg>`, `javascript:` href | attribute / href removed |
| `<img src="blob:...">`, `<img src="file:///...">`, `<a href="blob:...">` | **`src`/`href` removed** |
| `<img src="data:image/png;base64,...">` and `data:image/svg+xml` | kept |
| `<p style="position:fixed;inset:0">` | **style kept** (an overlay over the whole app; `style-src` allows inline) |
| `<form action>`, `<input>`, `<button>`, inline `<svg>`, `<math>` | **kept** |
| `target="_blank"` | removed |
| `<a id="location">` | `id` dropped; with `SANITIZE_NAMED_PROPS: true` it becomes `id="user-content-location"` |
| `<picture><source srcset>` | kept |

So the default is not enough. Use an explicit allowlist (`ALLOWED_TAGS`: p, br, hr, h1-h6, a, img, strong, em, b, i, s, del, ins, code, pre, kbd,
sub, sup, ul, ol, li, input (checkbox only), blockquote, table family, details, summary, div, span; `ALLOWED_ATTR`: href, src, alt, title, width, height, align, class, id,
open, colspan, rowspan, type, checked, disabled), `FORBID_ATTR: ['style']`, `SANITIZE_NAMED_PROPS: true` (this is also what makes ids like
`user-content-install` the GitHub convention), no `svg`, no `math`, no `form`, no `source`/`srcset`. Because DOMPurify removes `blob:` URLs, **rewrite `src`
after sanitizing**, on the DOM (walk the `img` nodes), not by string and not by hook. DOMPurify needs a DOM, so it runs on the main thread of the renderer (it is
a sanitizer pass over the parsed string, about 12 KB gzip). The parse itself can live in a Worker.

If the `html: false` slice is wanted first, it needs no sanitizer for safety and can add DOMPurify later; the allowlist above is the final design.

## Part 2: showing an image from a Project file

### What the CSP already allows (Electron 45 test, app CSP, `file://` page)

| Source | Result |
| --- | --- |
| `blob:` URL from bytes, `<img>` | works for every format that displays at all (Part 4) |
| `data:` URL | works |
| `file:///...` image in the page's folder | **works** |
| `file:///...` image in a different folder (the OS temp dir) | **works** |
| `http://127.0.0.1:port/x.png` | blocked, `securitypolicyviolation` on `img-src`, 0 requests at the server |
| `https://example.invalid/x.png` | blocked, same |
| control page without CSP, the same `http://` image | loaded, the server logged the request (so the check can see a leak) |

So **`img-src 'self' data: blob:` needs no change** for bytes handed over by RPC. No custom protocol is needed.

The file row is the trap: on a `file://` page, `'self'` matches other `file:` URLs. An `<img src="file:///C:/Users/x/Pictures/anything.png">` that a README
contributes will be displayed. It cannot be read back by script and the CSP blocks every remote host, so nothing leaks, but it is a path around "main decides
what is read". Two fixes, both cheap: never let a `src` from Markdown reach the DOM unrewritten (the rewrite in Part 5 already does this), and consider dropping
`'self'` from `img-src` if the app loads no images from its own bundle (not checked here; check `public/` and the stylesheets first). In dev
(`http://localhost:4200`) `'self'` is that origin and `file:` would not match; not tested.

### Two ways for main to hand the bytes over

**A. RPC plus Blob (recommended).** A new read-only operation next to `Files.read`, say `Files.readImage { cwd, file }` returning
`{ mime, bytes: Uint8Array }` or `tooLarge` / `unsupported`. Main runs `confine`, `stat`, the byte and pixel caps, sniffs the magic bytes for the MIME type (never the
extension), reads, returns. The renderer does `URL.createObjectURL(new Blob([bytes], { type: mime }))`, keeps the URL while the view lives, and `revokeObjectURL` on dispose.
Everything stays inside the existing RPC contract, the Effect handler and the test layer; nothing is added to the CSP.

| Bytes over the RPC (`layerSchemaBinary`, measured in Node with the repo's Effect 4.0.7) | `Uint8Array` | base64 `string` |
| --- | --- | --- |
| 1 MiB frame | 1,048,614 B, encode 2 ms, decode 1 ms | 1,398,142 B (+33 percent), encode 9 ms |
| 8 MiB | 8,388,648 B, 3 ms / 4 ms | 11,184,852 B, 36 ms |
| 15 MiB | 15,728,680 B, 5 ms / 3 ms | 20,971,560 B, over the 16 MiB frame limit |

Use `Schema.Uint8Array` (a `bytes` layout in the binary codec), not base64. The frame limit is 16 MiB for the whole message, so **a cap of 8 MiB per image** is
comfortable and covers retina screenshots (2-4 MB) and most photos; a bigger file gets the same "too large, open in the external editor" state as text.
`MAX_PREVIEW_BYTES` (1 MiB) is too small for images; a separate `MAX_IMAGE_BYTES` is needed.

**B. Custom protocol.** `protocol.registerSchemesAsPrivileged([{ scheme: 'timmy-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])` before `ready`, `protocol.handle` in main
resolving `timmy-file://<projectId>/<path>` through ProjectStore plus `confine`, and `img-src ... timmy-file:` in the CSP ([Electron protocol](https://www.electronjs.org/docs/latest/api/protocol):
privileged schemes must be registered before `app` is ready and only once; `bypassCSP` exists and must not be used here). Gains: no size cap from the RPC frame, streaming
and caching, the browser resolves relative URLs by itself if a `<base>` points at the scheme, video/audio/PDF could stream. Costs: a second read path outside the Effect RPC contract that must
re-implement confinement and Project lookup and run Effects from a non-RPC callback; a CSP change; any renderer code (or sanitised README HTML) can name any `timmy-file://` URL, so the
handler must also check `initiatorOrigin` and the Project. Worth it only if video/audio or very large files become a goal. Not recommended for this effort.

### Size limits that matter

- File bytes: 8 MiB cap, checked with `stat` before reading (same pattern as `readFileContent`).
- **Pixels.** Test: a 16000 x 16000 8-bit grayscale PNG built to be 1,117,239 bytes (zeros deflate about 230:1). It loaded, `onload` fired in 4-12 ms (the header only), `drawImage` forced the decode, and
  the renderer ("Tab") working set was 394-408 MB against 83-87 MB for an empty page: **about +310 MB** for 256 MB of gray pixels, so about 1 GB if the file had been RGBA. Chromium
  imposed no limit at this size. So bytes are the wrong cap. Read width and height from the header in main (PNG IHDR, GIF logical screen, JPEG SOF, WebP VP8/VP8L/VP8X, BMP header,
  ICO directory; `image-size` 2.1.0 is a maintained, dependency-free option for main, last published 2026-11) and refuse above, say, 40 megapixels (160 MB as RGBA). Do not use `nativeImage` for this: it
  decodes the whole image in main.
- SVG: the cap is on bytes (text), see below for why that is not enough.

### MIME type

Raster images displayed from a blob with type `image/png`, `''` and `application/octet-stream` alike (Chromium sniffs them). **SVG does not**: a blob with no type or
`application/octet-stream` fails, only `image/svg+xml` works (also as a `data:` URL). So main decides the MIME from magic bytes for raster and from a
parse of the first bytes (`<svg` after optional BOM, XML declaration, comments, doctype) for SVG; never from the extension alone.

## Part 3: SVG

Verified in Electron 45 (Chromium 156). Seven SVG variants, each loaded as `<img>` from a `blob:` URL and from a `data:` URL: `<script>` that requests a URL; `onload=`;
`<image href="http://...">`; `<style>@import url(http://...)` plus a `url()` background; `<use href="http://...#a">`; `<foreignObject>` with `<img>`, `<iframe>` and `<script>`; `@font-face src: url(http://...)`.

| Where it is shown | Result |
| --- | --- |
| `<img>` under the app CSP | all seven rendered as an image, **0 requests** at the local server |
| `<img>` on a page **with no CSP** | same, 0 requests: the restriction is the image context, not our CSP |
| `<iframe>` and `<object>` on the no-CSP page | the `<script>` and `onload` variants **ran** (4 requests logged) |
| `<iframe>` / `<object>` / `<embed>` of a blob under the app CSP | not run for SVG; the PDF test (Part 4) shows blob: frames and objects are blocked by `frame-src` / `object-src` falling back to `default-src 'self'` (`securitypolicyviolation` and `ERR_BLOCKED_BY_CSP`) |

This is the documented behaviour: in an image context JavaScript is disabled, external resources cannot load (but `data:` URLs inside work), `:visited` styles are not rendered; the
restrictions "don't apply when SVG content is viewed directly, or when it's embedded as a document via the `<iframe>`, `<object>`, or `<embed>` elements"
([MDN: SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image)).

**What an `<img>` SVG can still do:** draw whatever its markup says (text, gradients, filters, CSS and SMIL animation, `@media` queries such as `prefers-color-scheme`, `data:` images
inside); take CPU and memory. Measured, same page, SVG blob as `<img>`, main-thread stall while it loaded:

| SVG | Size | Time until painted | Longest main-thread gap |
| --- | --- | --- | --- |
| nested `<use>`, 2^12 = 4,096 rects | 805 B | 294 ms | 293 ms |
| 2^14 = 16,384 rects | 921 B | 1,205 ms | 1,201 ms |
| 2^16 = 65,536 rects | 1,037 B | 5,601 ms | 5,598 ms |
| 2^17 = 131,072 rects | 1,095 B | 13,703 ms | 13,702 ms |
| 4000 x 4000 `feGaussianBlur` plus `feTurbulence` | 235 B | 455 ms | 414 ms |

SVG decoding runs on the page's main thread, so a hostile SVG freezes the renderer for as long as it takes, and a byte cap cannot prevent it. A raster pixel
cap cannot either. Cheap mitigations: show SVG only as the text view first (it is text, highlighted as XML by #187) with an "Image" toggle; load it only after a click; never load SVGs
automatically from inside a README (show alt text, click to open). None is airtight; the freeze is bounded to the renderer's UI (Terminals live in main), so
treat it as an accepted residual risk, the same class as a hostile Markdown file.

Recommendation: **SVG as `<img>` from a `blob:` with an explicit MIME type, never as `innerHTML`, `<iframe>`, `<object>` or `<embed>`**, with the text/image toggle in a File View and, inside
Markdown, only after the same sanitizing as other images (`src` rewrite; an inline `<svg>` in README HTML is removed by the allowlist). "Never" would also be defensible; the only cost of allowing it is the CPU case.

## Part 4: other formats

Tested by loading each from a `blob:` and a `data:` URL on the app-CSP page, Electron 45 / Chromium 156. The bytes were generated in the page (canvas `toBlob` for png, jpeg, webp) or built by hand.

| Format | Result | Notes |
| --- | --- | --- |
| png, jpg, gif, webp | displays | animated gif and webp animate natively (animation itself not tested) |
| avif | displays | |
| ico | displays | |
| bmp | displays | |
| jxl | displays | a 1 x 1 sample loaded; MDN lists JPEG XL from Chrome 155 ([MDN image types](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)) and Electron 45 is Chromium 156. Rare in repos |
| tiff | **does not display** | the sample was built by hand and may be malformed, but MDN lists TIFF as Safari only |
| heic | not tested | not in MDN's web-safe list |
| svg | displays as `<img>` with `image/svg+xml` only | see Part 3 |

Recommended list for the reader: png, jpg/jpeg, gif, webp, avif, ico, bmp, svg (jxl optional). Anything else stays "binary".

**PDF.** `navigator.pdfViewerEnabled` is true in Electron 45 and Chromium's own viewer (a `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html` frame) renders a PDF from a `blob:` URL in
an `<iframe>`, an `<object>` and an `<embed>` (screenshot checked) on a page with no CSP. Under the app CSP all three are blocked (`frame-src` and `object-src` fall back to
`default-src 'self'`). With `frame-src blob:; object-src blob:` appended to the CSP the same three render. So PDF costs two CSP tokens, the full file in memory through the RPC (the 16 MiB frame limit;
PDFs bigger than about 15 MiB are common) and an embedded Chromium viewer with its own toolbar, print, download and in-PDF links. Recommendation: **out of scope for this effort**; offer
"open in the external editor", which the map already names as the escape hatch.

## Part 5: relative links and images inside a README

### The two traps (verified)

1. **Link clicks leave the app.** The `will-navigate` guard in `electron/main.ts` lets any `file://` URL through in production. Reproduced in a throwaway Electron app with the same guard
   and `<base href="./">`: clicking `<a href="docs/readme.md">` navigated the window to `.../dist/docs/readme.md` (`ERR_FILE_NOT_FOUND`); clicking `<a href="file:///.../other.html">` replaced the app
   with that file (it ran with the same `webPreferences`; in the real app that includes the preload). `https://` links are cancelled silently (nothing opens, since `setWindowOpenHandler` only sees
   `target="_blank"` and window.open). So rendered links must never be followed by the browser: a delegated `click` handler on the Markdown container calls `preventDefault()` and decides. The
   `will-navigate` guard should also be narrowed to the app's own URL (a main-side change for the implementation ticket).
2. **Relative image URLs resolve against the bundle**, not the Project (`<base href="./">`), and a `file:` URL loads from anywhere (Part 2). They must be rewritten before they reach the DOM.

### What the resolver does

One pure function in the renderer, `resolveInProject(readmePath, target)`, with unit tests; main's `confine` stays the authoritative check.

1. Split off `#fragment` and `?query` (drop the query for files).
2. Fragment only (`#install`): scroll inside the rendered document to `user-content-<slug>`. Needs heading ids: a markdown-it core rule with github-slugger (same algorithm as GitHub: lowercase, drop punctuation, spaces
   to `-`, `-1`, `-2` for duplicates), and DOMPurify's `SANITIZE_NAMED_PROPS` prefix.
3. A scheme (`^[a-z][a-z0-9+.-]*:`) or `//host`: `https:` becomes an external link (`target="_blank" rel="noopener noreferrer"` added **after** DOMPurify, which strips `target`;
   the existing `setWindowOpenHandler` then opens it in the browser); every other scheme (`http:`, `file:`, `mailto:`, `javascript:`, `data:`) renders as inert text.
4. Otherwise it is a path. Percent-decode (`%20`), treat `/x` as root of the Project (GitHub's meaning), else join to the README's directory, normalise `.` and `..`, and if the result climbs above the Project root
   render it inert. Output: a Project-relative path with `/`.
5. What opens: a `.md` or text file opens a File View (preview) like any tree click (#160); an image opens an image File View; a folder (`docs/`) reveals in the tree; a path that does not exist is
   shown as a disabled link with a title, found out on click through the `FileNotFound` error the RPC already has. Link existence is not checked up front (one `stat` per link is not worth it).
6. Images: after sanitizing, walk the `img` nodes. `https:`/`http:` sources are not fetched (the CSP would block them and log a violation for each): replace the node by a small placeholder showing the alt text.
   Project paths go to `Files.readImage` with a small concurrency (about 4) and a per-view cache by path, then `src` becomes a `blob:` URL; failures and `tooLarge` show the placeholder. `<picture>` and `srcset` are
   not allowed through; the fallback `<img>` is used (a dark-mode logo variant is lost).
7. All of it never goes through `[innerHTML]` unsanitized; Angular's own sanitizer would also remove `input` and `id` (Context), so bind a DOMPurify-cleaned string with `bypassSecurityTrustHtml`, or set `innerHTML` on an `ElementRef`
   after the same cleaning.

### What a README looks like in practice (629 READMEs in `node_modules`, rough regexes)

| Feature | READMEs | Share |
| --- | --- | --- |
| fenced code | 515 | 82 percent |
| a remote image (markdown or `<img>`) | 335 | 53 percent |
| a relative link | 114 | 18 percent |
| an `<img>` tag | 108 | 17 percent |
| a table | 81 | 13 percent |
| `align=` on an HTML block | 70 | 11 percent |
| a relative image | 44 | 7 percent |
| `<details>` | 6 | 1 percent |
| a task list | 3 | 0.5 percent |

So most image URLs in READMEs are remote badges and screenshots that will not load, because "loads nothing remote" is the requirement. The placeholder (alt text, small) is part of the design. Relative images are
the minority (7 percent), relative links more common (18 percent). Case: a README written on Linux may reference `Docs/A.md` for `docs/a.md`; Windows' file system will find it, a case-sensitive one will not.
Windows paths with `\` in a README are not a Markdown path separator; treat them as part of the name.

### Cost summary

| Piece | Where | Size |
| --- | --- | --- |
| markdown-it, DOMPurify, github-slugger, task-list rule, hljs fence hook | renderer, lazy chunk | about 52 KB gzip plus about 3 KB for slugger and rules |
| `Files.readImage` (+ `MAX_IMAGE_BYTES`, pixel cap, magic-byte MIME, SVG check) | `src/shared/files`, `electron/files`, `electron/rpc/files.ts` | one RPC, one `FileContent`-like schema, `confine` reused, header parsing (or `image-size`) |
| Blob URL lifecycle | renderer | create per view, revoke on dispose |
| `resolveInProject`, click handler, anchor scrolling | renderer | pure function plus a delegated listener |
| `will-navigate` narrowed to the app URL | `electron/main.ts` | one line |
| CSP | `src/index.html` | no change for Markdown and images; `frame-src blob:; object-src blob:` only if PDF is added later |

## Options compared (Markdown)

| Criterion | marked | markdown-it | micromark + gfm | remark pipeline |
| --- | --- | --- | --- | --- |
| gzip alone / with DOMPurify | 14.7 / 26.3 KB | 40.7 / 52.2 KB | 21.0 / 32.7 KB | 53.0 KB / n.a. |
| Raw HTML by default | passed through | escaped (`html: true` to allow) | escaped (`allowDangerousHtml` to allow) | escaped |
| `javascript:` links | kept | refused | dropped | n.a. |
| Tables, strikethrough, autolink | built in | tables, strike built in; autolink `linkify: true` | built in | built in |
| Task lists | built in | plugin or own rule | built in | built in |
| 1 MiB real corpus (ms, warm) | 80 | 74 | 948 | not measured |
| Hostile input | quadratic (7 s at 200 KB), stack overflow | flat, at most 0.2 s | quadratic (more than 15 s) | not measured |
| Highlighter hook | extension | `highlight` option | none | rehype plugin |
| Structural rewrite of links/images | `walkTokens` | token stream | post-process HTML | mdast/hast (best) |
| Maintenance (npm `time.modified`) | 2026-11 | 2026-10 | 2026-09 | n.a. |

## Recommendation

**Markdown: markdown-it, `html: true`, DOMPurify with the strict allowlist, `highlight` option wired to highlight.js (#187), heading ids with github-slugger, a small own rule for task lists, in one lazy chunk.**

- It is the only candidate that needs no worker and no time limit for hostile input at the 1 MiB cap (at most 0.2 s on everything tried; 0.1 s for 1 MiB of real READMEs).
- 52 KB gzip with the sanitizer, in a lazy chunk, 26 KB more than marked. If weight matters more than robustness, take marked (already a dependency, 26 KB gzip with DOMPurify) and run the parse in a Worker with a timeout.
  micromark is not recommended: slowest, quadratic, no code hook.
- Allowlist, `style` forbidden, no `svg`/`form`, ids prefixed, **`src`/`href` rewritten after sanitizing**.
- Remove the unused `marked` dependency if markdown-it is chosen.

**Images: bytes by RPC, Blob URL in the renderer. No custom protocol, no CSP change.**

- New `Files.readImage`: `confine`, `stat`, 8 MiB cap, pixel cap from the header (about 40 megapixels), MIME from magic bytes, `Uint8Array` on the wire.
- Never let a README's `src` reach the DOM; rewrite or replace (remote becomes a placeholder).

**SVG: `<img>` from a Blob with `image/svg+xml` only, text/image toggle, never inline or framed.** Accept the CPU freeze as a residual risk (1.1 KB took 13.7 s).

**Formats:** png, jpg, gif, webp, avif, ico, bmp, svg (jxl optional). PDF and the rest: external editor.

**Links:** intercept every click; one pure resolver; https opens externally through the existing handler; narrow `will-navigate`.

## Open items and limits of this research

- Timings for Markdown are Node 24, not Chromium; DOMPurify's cost on a 1 MiB document was not measured in Chromium (jsdom is not representative). Measure inside Electron when building.
- Not tested: the dev-server page (`http://localhost:4200`) for `file:` images and workers; animated GIF/WebP playback; HEIC; a TIFF built by a real encoder; Angular's rendering of the final DOM (bundle numbers are
  esbuild, not the Angular build); `image-size`'s accuracy on every format; whether dropping `'self'` from `img-src` breaks the app's own assets.
- The hostile-input table uses synthetic inputs; other pathological shapes may exist. The README percentages are npm packages' READMEs matched by rough regexes.
- The `file://` quirk (`'self'` matching other `file:` URLs) and the navigation behaviour are observed behaviour of Chromium 156 / Electron 45.1.0, not a documented guarantee.
- The reproduced navigation test used a copy of the guard, not the real `electron/main.ts`; the real window also loads a preload, which was not part of the test.
- Throwaway installs and scripts live outside the repository; this file is the only artefact.
