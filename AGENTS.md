# Project rules

This repo is an Electron desktop app with an Angular renderer and Effect for
domain logic. These rules are mandatory for new code and refactors.

## Electron security and process model

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Expose a narrow, typed API through `contextBridge` in `electron/preload.ts`.
  Never expose `ipcRenderer`, `require`, or Node globals to the renderer.
- Keep the main process thin. It owns privileged APIs, windows and lifecycle;
  domain logic belongs in the renderer.
- Enforce a strict CSP in `src/index.html` (no inline scripts).
- Open external links with `shell.openExternal`; block in-app navigation away
  from the app origin.
- Never load untrusted remote content into a window with preload access.
- Do not use synchronous IPC (`sendSync`); use `invoke`/`handle` or ports.
- Offload heavy work off the main thread (utility process, worker, or renderer).

## Effect mental model

`Effect<Success, Error, Requirements>` describes a program. Services are tags in
the `Requirements` channel, `Layer`s provide them, and a runtime executes the
program at the edge.

- Domain code returns effects; it does not run them.
- Run effects only at the edge: Angular via `EffectRuntime`, Electron main via
  `ManagedRuntime`, tests via `it.effect` / `Effect.runPromise`.
- Current renderer utilities:
  - `src/app/core/desktop-api.ts` — `DesktopApi` service tag.
  - `src/app/core/desktop-layers.ts` — `layerDesktop`, `makeDesktopTestLayer`.
  - `src/app/core/effect-runtime.ts` — the single root `EffectRuntime`.

## Effect version and imports

- This repo uses Effect 4.x (currently 4.0.7). Import from `effect`, `effect/rpc`
  and `effect/reactivity`. Do not add `@effect/*` runtime packages or import
  `effect/unstable/*` (different API line). `@effect/vitest` is the only allowed
  `@effect/*` dev dependency.
- Use `FileSystem` / `Path` from `effect`; do not add `@effect/platform`.
- Keep exactly one `effect` version in the dependency tree.

Examples copied from other repos often use v3 or v4-beta names. Translate them:

| You may see (v3 / v4 beta)       | Use here (Effect 4.x)              |
| -------------------------------- | ---------------------------------- |
| `Context.Tag` / `Effect.Service` | `Context.Service`                  |
| `ServiceMap.Service`             | `Context.Service`                  |
| `Schema.TaggedErrorClass`        | `Schema.TaggedError`               |
| `Layer.scoped(Tag, effect)`      | `Layer.effect(Tag, effect)`        |
| `Layer.unwrapScoped`             | `Layer.unwrap`                     |
| `Effect.catchAll`                | `Effect.catch`                     |
| `Effect.either`                  | `Effect.result`                    |
| `Mailbox`                        | `Queue`                            |
| `@effect/rpc`                    | `effect/rpc`                       |
| `@effect-atom/atom`              | `effect/reactivity`                |

## Writing effects

- Use `Effect.fn("Domain.method")(function* (...) { ... })` when a tracing span
  helps, `Effect.fnUntraced` otherwise. Never write
  `(...args) => Effect.gen(function* () { ... })`.
- Do not wrap a single `return yield* effect` in `Effect.fnUntraced`; return the
  effect directly.
- Use `Effect.gen` for multi-step flows and combinators for single steps.
  Pipeable values use `.pipe(...)`; non-pipeable values use `pipe()` / `flow()`.
  Do not write nested calls like `f(g(x))`.
- Inside generators, `yield*` services and effects directly. Outside generators,
  call `.asEffect()` before piping.
- Keep `async`/`await` at real Promise boundaries only (IPC, DOM APIs, third
  party SDKs) via `Effect.tryPromise`. Domain logic stays in Effect.
- No floating effects: every effect is returned, yielded, forked into a managed
  scope, or run at the edge.
- Default to immutable values: `readonly` properties and `ReadonlyArray`.

## Errors

- Application code never throws and never uses the global `Error` class. Define
  `Schema.TaggedError` classes with a `_tag`.
- Use `reason: Schema.Literals([...])` with PascalCase values for failure
  categories, and `detail` for human-readable text. Never name a field `message`:
  it shadows `Error.prototype.message` and breaks `Equal`/`Hash`.
- Expose typed errors only for failures a caller can act on. Catch non-actionable
  failures at the service boundary and `Effect.die`; do not leak defects.
- Do not invent generic errors such as `XFailed`, `InternalError` or
  `UnknownError`. Reuse an existing tagged error when it fits.
- Match errors by tag with `Effect.catchTag` / `Effect.catchTags`; never probe
  with `"_tag" in error` and never erase the channel to `unknown`.
- Use `Cause.pretty(...)` when a cause must become user-visible text. Do not add
  bespoke error-to-message helpers.
- Errors that cross IPC contain serializable fields only — never a JS `cause`.

## Services and layers

- Define a service as
  `class X extends Context.Service<X, Shape>()("domain/X") {}`.
- Consumers `yield* X` (or use `X.use(...)` for a one-liner). Do not pass service
  instances as function arguments.
- Build layers with `Layer.effect(Tag, effect)` or `Layer.succeed(Tag, value)`.
  Compose with `Layer.provide` / `Layer.merge`; expose only what downstream needs.
- Name the primary layer `layerX`; test doubles `makeXTestLayer` or `layerXTest`.
  Keep the production constructor reusable so tests can swap dependencies.
- Final live layers must be typed `Layer.Layer<ProvidedServices>`; let
  intermediate layers infer.
- Layer memoization is per runtime. Do not rebuild layers per call, and do not
  use `Layer.fresh` unless a second instance is genuinely required.
- Use `ManagedRuntime` for app-lifetime services (RPC server, file watchers,
  subscriptions). A bare `Effect.runPromise` closes the scope and kills daemons.
- UI code depends on service tags, never on `window.desktop`, `ipcRenderer`,
  `fetch` clients, or storage APIs directly.

## Electron IPC boundary

- The renderer is untrusted; the main process is privileged. Keep privileged code
  small and auditable.
- Preload exposes only the constant-size `desktop.connect()` handshake, never
  raw channels or domain methods.
- `electron/ipc/` holds only the handshake (`registerHandshakeIpc`), registered
  from `electron/ipc/index.ts`; `main.ts` calls `registerIpc()` once. Never add
  handlers directly to `main.ts`. Domain handlers live in `electron/rpc/<domain>.ts`.
- Channel names live in the shared contract module (`src/shared/*`); never
  repeat the string literal in the handler and the preload.
- An IPC handler is a controller: validate input, call a service, return
  serializable data. No business logic in the handler or the preload.
- Define the contract once in `src/shared` (channel names, payload/result
  schemas, wire errors) and import it from both sides.
- Only structured-cloneable data crosses IPC. Never send effects, streams,
  runtimes, class instances, or `Error` objects.
- All renderer ⇄ main calls go through one `RpcGroup` contract (`DesktopRpcs` in
  `src/shared/rpc/desktop-rpcs.ts`) over a `MessagePort` (`effect/rpc`, with
  `RpcSerialization.layerSchemaBinary`), with a fresh port per renderer load so a
  reload interrupts the previous load's streams.
- Validate inputs at the boundary and return typed, serializable failures.
- Keep IPC handlers thin: validate, delegate to a service, return data.

## Angular integration

- Run effects only at UI boundaries through `EffectRuntime.run(...)`, then write
  the result into signals. Do not expose effects to templates.
- Domain services return effects; they never inject `EffectRuntime`.
- Keep loading, failure, empty and success states distinct. Never collapse a
  failure or loading state into fake empty data.
- Tie long-lived streams and subscriptions to `DestroyRef` so navigation and
  component teardown stop them.
- Angular DI services own UI state; Effect services own domain logic.

## Structure and naming

- Colocate by domain and keep directories flat. Feature code lives with its
  feature, not in global `shared` modules.
- No barrel `index.ts` files; import from the defining module.
- Wire contracts live in `src/shared`; main-only code in `electron/`;
  renderer-only code in `src/app`.
- Brand entity IDs with `Schema.brand` in the owning module; construct with
  `.make` / `makeUnsafe`, never cast with `as`.
- Name schemas and annotate them with `.annotate({ identifier: "Name" })` when
  they are part of a public contract.

## Testing

- Tests use production composition. Mock only true external boundaries by
  swapping a layer (`Layer.mock` or `makeXTestLayer`), never by mocking modules
  or atoms.
- Prefer `@effect/vitest` (`it.effect`, `it.layer`) for Effect code; small unit
  tests may use `Effect.runPromise` with `Effect.flip` for failures.
- Use `TestClock.adjust` / `TestClock.setTime` for time-dependent code. No
  arbitrary sleeps, timing races, or uncontrolled external state.
- Test behavior and contracts, not implementation details. Add a regression test
  for every bug fix.
- Coverage is a floor, not a goal: aim for 80%+ on domain code and skip
  low-value or redundant tests.

## Observability

- Trace with `Effect.withSpan` or a named `Effect.fn`. Do not add manual logging
  for error paths; spans already capture failures and context.
- Log only domain-level events (startup, sync progress).

## Review checklist

- No `Effect.runPromise` outside the edge (runtime, tests, scripts).
- No `throw new Error` and no untyped error channels.
- No direct `window.desktop` / `ipcRenderer` use outside the service layer.
- IPC payloads are serializable and validated; errors are tagged.
- New domain code has a test through its layer; failures are covered.
- Electron security flags and CSP are unchanged.
