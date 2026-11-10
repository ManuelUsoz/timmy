import path from 'node:path';
import { app } from 'electron';
import { Effect, Layer, ManagedRuntime, Option } from 'effect';
import { RpcServer } from 'effect/rpc';
import { DesktopRpcs } from '../../src/shared/rpc/desktop-rpcs';
import { layerHookChannel } from '../hooks/hook-channel';
import { claudeSettingsFile, layerHookIntegrations } from '../hooks/hook-integrations';
import { layerElectronFolderPicker } from '../projects/electron-folder-picker';
import { layerFolderPickerTest } from '../projects/folder-picker';
import { layerProjectStore } from '../projects/project-store';
import { layerSettingsStore } from '../settings/settings-store';
import { layerDesktopHandlers } from './index';
import { layerElectronWindowHost } from '../window/electron-window-host';
import { layerIpcServer } from './ipc-server';
import { layerQuitGate } from '../workspace/quit-gate';

/** Projects live in one database file in the app's data directory. */
const layerProjectStoreFile = Layer.unwrap(
  Effect.sync(() => layerProjectStore(path.join(app.getPath('userData'), 'timmy.db'))),
);

/** Settings live in one small JSON file next to the database. */
const layerSettingsStoreFile = Layer.unwrap(
  Effect.sync(() => layerSettingsStore(path.join(app.getPath('userData'), 'settings.json'))),
);

/** Claude Code's settings are the user's own file; the e2e app writes to a copy in its own data directory instead. */
const layerHookIntegrationsLive = Layer.unwrap(
  Effect.sync(() =>
    layerHookIntegrations(process.env['TIMMY_E2E'] === '1' ? path.join(app.getPath('userData'), 'claude', 'settings.json') : claudeSettingsFile()),
  ),
);

/** The local channel Hooks post to, one for the app's lifetime. */
const layerHookChannelLive = layerHookChannel.pipe(Layer.provide(layerHookIntegrationsLive));

/** The native folder dialog cannot be driven by Playwright: the e2e app picks `TIMMY_E2E_PICK_FOLDER` instead. */
const e2ePickFolder = process.env['TIMMY_E2E'] === '1' ? process.env['TIMMY_E2E_PICK_FOLDER'] : undefined;
const layerFolderPicker = e2ePickFolder === undefined ? layerElectronFolderPicker : layerFolderPickerTest(Option.some(e2ePickFolder));

/** The RPC server for the app's lifetime; windows attach through `RpcPortHandoff`. */
const layerRpcServer = RpcServer.layer(DesktopRpcs).pipe(
  Layer.provideMerge(layerIpcServer),
  Layer.provide(layerDesktopHandlers.pipe(Layer.provide(layerProjectStoreFile), Layer.provide(layerSettingsStoreFile), Layer.provide(layerElectronWindowHost), Layer.provide(layerFolderPicker), Layer.provide(layerHookIntegrationsLive), Layer.provide(layerHookChannelLive))),
);

/**
 * App-lifetime runtime running the RPC server. Disposed on `before-quit`. Its `QuitGate` is the one the Workspace handlers
 * answer through, so `main.ts` can hold the quit until the window has saved.
 */
export const MainRuntime = ManagedRuntime.make(layerRpcServer.pipe(Layer.provideMerge(layerQuitGate)));
