# timmy

A desktop app built with **Electron** (main process) and an **Angular** renderer.

## Requirements

- Node.js 20+ (tested with Node 24)
- npm

## Commands

| Command             | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | Angular dev server on `localhost:4200` + Electron with HMR and DevTools      |
| `npm run preview`   | Production build, then runs the app locally                                  |
| `npm run build`     | Builds the Angular renderer (`dist/renderer`) and Electron code (`dist-electron`) |
| `npm run package`   | Builds and creates an installer with electron-builder (output in `release/`) |
| `npm test`          | Runs the Angular unit tests (Vitest)                                         |
| `npm run typecheck` | Type-checks the Electron main/preload code                                   |

## Project layout

```
electron/
  main.ts            # app lifecycle, BrowserWindow, security settings
  ipc/
    index.ts         # composition root: registerIpc() called once from main
    handshake.ts     # hands a MessagePort to the renderer (the only ipcMain handler)
  rpc/
    index.ts         # layerDesktopHandlers (merge of all domain handler layers)
    app-info.ts      # AppInfo.get handler (one file per domain)
    server.ts        # serves DesktopRpcs over a MessagePort
    runtime.ts       # MainRuntime (ManagedRuntime, disposed on quit)
  preload.ts         # exposes only desktop.connect() as window.desktop
src/                 # Angular application (renderer)
  app/
    core/
      desktop-api.ts    # DesktopApi service (RpcClient over DesktopRpcs)
      desktop-layers.ts # layerDesktop + makeDesktopTestLayer
      desktop-port.ts   # acquires the MessagePort from the preload handshake
      desktop-error.ts  # typed desktop error (Schema.TaggedError)
      effect-runtime.ts # single root ManagedRuntime for the renderer
    app.ts              # UI; runs effects at the boundary and writes signals
  shared/
    app-info/app-info.rpc.ts  # AppInfo RPC contract shared by main + renderer
    rpc/                      # DesktopRpcs, handshake constants, protocol helpers
  types/desktop.d.ts    # window.desktop typings for the preload bridge
  index.html            # renderer entry + Content Security Policy
scripts/
  build-electron.mjs # bundles main + preload with esbuild
docs/assets/img/     # app icons (also used for the window icon in dev)
public/favicon.ico   # renderer favicon
electron-builder.yml # packaging/installer configuration
```

## How the pieces fit

- `npm run dev` starts `ng serve`, waits for it to respond, bundles the Electron
  files and launches Electron pointed at `http://localhost:4200`
  (`ELECTRON_RENDERER_URL`). Angular hot-reloads; changes to `electron/*.ts`
  require restarting the command.
- For production, `ng build` writes the static app to `dist/renderer` with a
  relative `baseHref`, so it can be loaded over `file://`.
- The renderer never gets Node.js access. Everything native goes through the
  preload bridge:

```ts
// electron/rpc/app-info.ts
export const layerAppInfoHandlers = AppInfoRpcs.toLayer({
  'AppInfo.get': () => Effect.succeed({ version: app.getVersion() }),
});

// electron/preload.ts
contextBridge.exposeInMainWorld('desktop', {
  connect: () => ipcRenderer.send(RPC_CONNECT_CHANNEL),
});
```

```ts
// src/app/app.ts
void this.runtime.run(
  Effect.gen(function* () {
    const desktop = yield* DesktopApi;
    return yield* desktop.AppInfo.get();
  }).pipe(
    Effect.match({
      onFailure: (failure) => this.error.set(failure.detail),
      onSuccess: (appInfo) => this.info.set(appInfo),
    }),
  ),
);
```

## Effect

[`effect`](https://effect.website) is installed once at the project root, so both
processes can import it. Each process runs its own runtime, and only plain
(structured-cloneable) data can cross the IPC boundary — never an `Effect` value.

The architecture rules live in [`AGENTS.md`](./AGENTS.md). The short version:

- **Renderer (recommended)** — business logic, async workflows and typed errors.
  `src/app/core/desktop-api.ts` defines the `DesktopApi` service (an RPC client);
  the production layer (`desktop-layers.ts`) connects it to main through a
  MessagePort from the preload handshake; `App` runs the effect
  through the root `EffectRuntime` and writes the result into signals. Tests
  provide `makeDesktopTestLayer(...)` instead of mocking `window.desktop`.
- **Main process (optional)** — useful when a handler actually orchestrates
  side effects (file system, retries, background work). Use a `ManagedRuntime`
  for anything that lives longer than one call:

```ts
ipcMain.handle('files:read', (_event, file: string) =>
  Effect.runPromise(
    readFile(file).pipe(
      Effect.retry(Schedule.exponential('200 millis')),
      Effect.map((text) => ({ ok: true as const, text })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, error: String(error) })),
    ),
  ),
);
```

Keep the main process thin: it holds the privileged APIs, so put as much logic
as possible in the renderer and expose narrow, typed IPC methods.

## Window effects

The main window uses the native system material where available:

- **Windows 11 (22H2+)**: Mica backdrop (`backgroundMaterial: 'mica'`)
- **macOS**: `under-window` vibrancy
- **Linux / older Windows**: solid dark background fallback

The renderer background is intentionally translucent (`src/styles.css`) so the
material shows through, with `backdrop-filter` glass cards on top. If you prefer
an opaque window, set `backgroundColor` in `electron/main.ts` to `#0b0d12` and
make the body background opaque.

## Icons

The icon set lives in `docs/assets/img`:

- `icon.ico` → Windows executable + installer (and `public/favicon.ico`)
- `icon.icns` → macOS bundle
- `icon.png` (512×512) → Linux + the window icon while running from source

Packaging icons are configured in `electron-builder.yml`. The favicon is copied
from the same set to `public/favicon.ico`.

## Security notes

The Electron window follows the security defaults from the Electron docs:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- strict CSP in `src/index.html` (no inline scripts)
- external `https://` links open in the default browser
- navigation away from the app origin is blocked
