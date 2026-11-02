import path from 'node:path';
import { app } from 'electron';
import { Effect, Layer, ManagedRuntime, Option } from 'effect';
import { RpcServer } from 'effect/rpc';
import { DesktopRpcs } from '../../src/shared/rpc/desktop-rpcs';
import { layerAttachmentStore } from '../attachments/attachment-store';
import { layerElectronImageResizer } from '../attachments/electron-image-resizer';
import { layerElectronFolderPicker } from '../projects/electron-folder-picker';
import { layerFolderPickerTest } from '../projects/folder-picker';
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

/** Draft images live as files in a folder of the app's data directory. */
const layerAttachmentStoreFiles = Layer.unwrap(
  Effect.sync(() => layerAttachmentStore(path.join(app.getPath('userData'), 'attachments'))),
).pipe(Layer.provide(layerElectronImageResizer));

/** The native folder dialog cannot be driven by Playwright: the e2e app picks `TIMMY_E2E_PICK_FOLDER` instead. */
const e2ePickFolder = process.env['TIMMY_E2E'] === '1' ? process.env['TIMMY_E2E_PICK_FOLDER'] : undefined;
const layerFolderPicker = e2ePickFolder === undefined ? layerElectronFolderPicker : layerFolderPickerTest(Option.some(e2ePickFolder));

/** The RPC server for the app's lifetime; windows attach through `RpcPortHandoff`. */
const layerRpcServer = RpcServer.layer(DesktopRpcs).pipe(
  Layer.provideMerge(layerIpcServer),
  Layer.provide(layerDesktopHandlers.pipe(Layer.provide(layerSessionRepoFile), Layer.provide(layerSettingsStoreFile), Layer.provide(layerAttachmentStoreFiles), Layer.provide(layerElectronWindowHost), Layer.provide(layerFolderPicker))),
);

/** App-lifetime runtime running the RPC server. Disposed on `before-quit`. */
export const MainRuntime = ManagedRuntime.make(layerRpcServer);
