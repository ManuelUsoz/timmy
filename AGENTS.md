# Project rules

Electron desktop app: Angular renderer, Effect 4.x (4.0.7) for domain logic.
`npm run lint` enforces the mechanical rules (imports, v3 names, errors, edges);
reviewers apply `CODING_STANDARDS.md`.

## Electron security and process model

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; strict CSP
  in `src/index.html` (no inline scripts). Leave these as they are.
- The renderer is untrusted, main is privileged: keep main thin and auditable
  (privileged APIs, windows, lifecycle).
- Preload exposes only the constant-size `desktop.connect()` handshake through
  `contextBridge`; `electron/ipc/` holds only that handshake.
- All renderer ⇄ main calls go through the `DesktopRpcs` RpcGroup
  (`src/shared/rpc/desktop-rpcs.ts`) over a `MessagePort`, a fresh port per
  renderer load so a reload interrupts the previous load's streams. Domain
  handlers live in `electron/rpc/<domain>.ts`; contracts in `src/shared`.
- Only structured-cloneable data crosses IPC: schemas, tagged errors with
  serializable fields. No effects, streams, runtimes, class instances or JS `cause`.
- Open external links with `shell.openExternal`; block navigation away from the
  app origin; load no remote content into a window with preload access.
- Move heavy work off the main thread (utility process, worker, or renderer).

## Effect mental model

`Effect<Success, Error, Requirements>` describes a program. Services are tags in
`Requirements`, `Layer`s provide them, a runtime executes the program at the edge.

- Domain code returns effects. The edges run them: Angular via `EffectRuntime`
  (`src/app/core/effect-runtime.ts`), main via `MainRuntime`
  (`electron/rpc/runtime.ts`), tests via `it.effect`.
- App-lifetime services (RPC server, watchers, subscriptions) live in a
  `ManagedRuntime`; a bare `Effect.runPromise` closes the scope and kills them.
- Renderer code depends on `DesktopApi` (`src/app/core/desktop-api.ts`), provided
  by `layerDesktop`; tests use `makeDesktopTestLayer` (`src/app/core/desktop-layers.ts`).
- Imports come from `effect`, `effect/rpc`, `effect/reactivity`; `FileSystem` /
  `Path` come from `effect`. Keep exactly one `effect` version in the tree.

## Effect 4 idioms

Examples from other repos are often v3 or v4-beta; lint flags the renamed APIs.
Beyond those:

- Service: `class X extends Context.Service<X, Shape>()("domain/X") {}`;
  consumers `yield* X` or `X.use(...)`.
- Layers: `Layer.effect(Tag, effect)` / `Layer.succeed(Tag, value)`; name them
  `layerX`, test doubles `makeXTestLayer` / `layerXTest`.
- Errors: `Schema.TaggedError` with `reason: Schema.Literals([...])` (PascalCase)
  and `detail: Schema.String`; match with `Effect.catchTag` / `Effect.catchTags`.
- Functions: `Effect.fn("Domain.method")(function* ...)` when a span helps,
  `Effect.fnUntraced` otherwise.
- Inside generators `yield*` services and effects directly; outside, call
  `.asEffect()` before piping.
- Brand entity IDs with `Schema.brand` in the owning module; build them with
  `.make` / `makeUnsafe`, never `as`.
