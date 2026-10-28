import { app } from 'electron';
import { Effect } from 'effect';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';

export const layerAppInfoHandlers = AppInfoRpcs.toLayer({
  'AppInfo.get': () =>
    Effect.sync(() => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    })),
});
