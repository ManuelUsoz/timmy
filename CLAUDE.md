# CLAUDE.md

Electron desktop app: Angular renderer + Effect 4.0.7 domain logic.
Mandatory rules live in `AGENTS.md`. This file is only the map and Effect usage; it does not repeat the rules.

## Structure

```
src/shared/<domain>/<domain>.rpc.ts   RPC contract per domain (Rpc.make + RpcGroup)
src/shared/rpc/
  desktop-rpcs.ts                     DesktopRpcs: the single merge point of all groups
  handshake.ts                        RPC_CONNECT_CHANNEL, RPC_PORT_MESSAGE, DesktopBridge
  wire-error.ts                       wire error pattern + toWireDefect
  message-port-protocol.ts            client/server protocol over a MessagePortAdapter
electron/main.ts                      windows + lifecycle only
electron/preload.ts                   constant size: exposes only desktop.connect()
electron/ipc/handshake.ts             the only ipcMain handler: hands a MessagePort to the renderer
electron/rpc/<domain>.ts              handler layers per domain
electron/rpc/index.ts                 layerDesktopHandlers (merge of all handler layers)
electron/rpc/ipc-server.ts            IpcServerPort, RpcPortHandoff, layerIpcServer (swap port per window load)
electron/rpc/runtime.ts               MainRuntime (ManagedRuntime) running the RpcServer for the app lifetime
electron/<domain>/                    main-only services per domain: files, notification (NotificationBus:
                                      latest per Source, replay, retraction; ADR 0010), projects (ProjectStore
                                      in timmy.db), settings, terminal (node-pty), window
src/app/core/                         DesktopApi, layerDesktop, desktop-port, EffectRuntime
src/app/features/                     feature code, one folder per feature
```

## Data flow

renderer -> `DesktopApi` (RpcClient) -> MessagePort -> RpcServer in main
(`MainRuntime`) -> handler layer.

## Adding a domain

1. `src/shared/<domain>/<domain>.rpc.ts`: schemas, errors, `RpcGroup`.
2. Merge the group into `DesktopRpcs` (`src/shared/rpc/desktop-rpcs.ts`).
3. `electron/rpc/<domain>.ts`: `layerXHandlers = XRpcs.toLayer({...})`.
4. Merge it in `electron/rpc/index.ts`.
5. Test via `makeDesktopTestLayer` in a spec next to the consumer.

## Effect cheat-sheet

```ts
// contract
export const NotesRpcs = RpcGroup.make(
  Rpc.make('Notes.list', { success: Schema.Array(Note), error: NotesError }),
);
// handlers (main)
export const layerNotesHandlers = NotesRpcs.toLayer({
  'Notes.list': () => Effect.succeed([]),
});
// service
class Notes extends Context.Service<Notes, Shape>()('domain/Notes') {}
const layerNotes = Layer.effect(Notes, Effect.gen(function* () { /* ... */ }));
// error: reason + detail, never `message`, never `cause`
class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
  reason: Schema.Literals(['NotFound']),
  detail: Schema.String,
}) {}
// functions
const load = Effect.fn('Notes.load')(function* (id: string) { /* ... */ });
const quick = Effect.fnUntraced(function* (id: string) { /* ... */ });
// non-actionable failure at a service boundary -> defect
effect.pipe(toWireDefect);
// renderer edge: run returns an Exit; write it into signals
const exit = await runtime.run(Effect.gen(function* () {
  const api = yield* DesktopApi;
  return yield* api.AppInfo.get();
}));
// tests (@effect/vitest)
it.effect('gets app info', () =>
  Effect.gen(function* () {
    const api = yield* DesktopApi;
    expect(yield* api.AppInfo.get()).toEqual(info);
  }).pipe(Effect.provide(makeDesktopTestLayer(handlers))));
```

## Notes

- Effect 4.0.7 has no MsgPack; serialization is `RpcSerialization.layerSchemaBinary`
  (`layerPortSerialization` in `message-port-protocol.ts`).
- `npm run typecheck` covers electron only. Renderer: `npx tsc -p tsconfig.app.json --noEmit`
  and `npx tsc -p tsconfig.spec.json --noEmit`.
- Run tests with `npx ng test --watch=false`. Do not use `--include=src/app/core/**`:
  it treats non-spec files as suites.
- Sandboxed preload cannot pass ports through contextBridge; the port arrives via
  `window.postMessage(RPC_PORT_MESSAGE)`. Check origin on receipt.

## E2E and visual regression

`@playwright/test` drives the real Electron app with `TIMMY_E2E=1`, which gives each run its own data directory and
answers the native folder dialog with `TIMMY_E2E_PICK_FOLDER`.
Config: `playwright.config.ts`. Fixture and helpers (`Timmy`: openPanel, switchMode, addDemoProject, openProjectTerminal, newTerminal, shot): `e2e/fixtures.ts`.
Specs live in `e2e/<area>/<name>.spec.ts`; baselines in `__screenshots__/` next to them (committed).

- Add a spec per user-visible flow; call `timmy.shot('<flow>-<state>')` for each visual state.
- Mask volatile UI (dates, durations) with `timmy.shot(name, { mask: [...] })`.
- After an intentional UI change run `npm run e2e:update`, then review the PNG diffs in git.
- Failures: `e2e-output/report/index.html` (traces, diffs). Baselines are machine dependent; generate them on the same OS that runs the suite.

## Commands

- `npm run e2e`: build + Playwright suite (`e2e:fast` skips the build, `e2e:update` regenerates baselines)
- `npm run dev`: renderer (ng serve :4200) + electron
- `npm run build`: renderer + electron; `build:renderer`, `build:electron` separately
- `npm run typecheck`: electron tsc
- `npm test`: `ng test`
- `npm run package`: build + electron-builder

## Agent skills

### Issue tracker

Issues live as GitHub issues in `ManuelUsoz/timmy`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
