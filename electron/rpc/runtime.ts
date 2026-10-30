import path from 'node:path';
import { app } from 'electron';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { RpcServer } from 'effect/rpc';
import { DesktopRpcs } from '../../src/shared/rpc/desktop-rpcs';
import { layerSettingsStore } from '../settings/settings-store';
import { layerSessionRepo } from '../sessions/session-repo';
import { layerDesktopHandlers } from './index';
import { layerElectronWindowHost } from '../window/electron-window-host';
import { layerIpcServer } from './ipc-server';

/** Sessions live in one database file in the app's data directory. */
const layerSessionRepoFile = Layer.unwrap(
  Effect.sync(() => layerSessionRepo(path.join(app.getPath('userData'), 'timmy.db'))),
);

/** Settings live in one small JSON file next to the database. */
const layerSettingsStoreFile = Layer.unwrap(
  Effect.sync(() => layerSettingsStore(path.join(app.getPath('userData'), 'settings.json'))),
);

/** The RPC server for the app's lifetime; windows attach through `RpcPortHandoff`. */
const layerRpcServer = RpcServer.layer(DesktopRpcs).pipe(
  Layer.provideMerge(layerIpcServer),
  Layer.provide(layerDesktopHandlers.pipe(Layer.provide(layerSessionRepoFile), Layer.provide(layerSettingsStoreFile), Layer.provide(layerElectronWindowHost))),
);

/** App-lifetime runtime running the RPC server. Disposed on `before-quit`. */
export const MainRuntime = ManagedRuntime.make(layerRpcServer);
