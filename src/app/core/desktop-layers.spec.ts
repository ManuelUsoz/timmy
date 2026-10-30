import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { AppInfoRpcs, type AppInfo } from '../../shared/app-info/app-info.rpc';
import { DesktopApi } from './desktop-api';
import { layerChatUnused, layerSessionsUnused, layerWindowUnused, makeDesktopTestLayer } from './desktop-layers';
import { acquireDesktopPort } from './desktop-port';

const appInfo: AppInfo = {
  name: 'timmy',
  version: '0.1.0',
  electron: '45.1.0',
  chrome: '156.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  cwd: '/work',
};

const handlers = AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.succeed(appInfo) });

describe('DesktopApi', () => {
  it.effect('reads app info through the test layer', () =>
    Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      const info = yield* desktop['AppInfo.get']();
      expect(info).toEqual(appInfo);
    }).pipe(
      Effect.provide(makeDesktopTestLayer(Layer.mergeAll(handlers, layerChatUnused, layerSessionsUnused, layerWindowUnused))),
    ),
  );

  it.effect('fails with NotInElectron when the bridge is absent', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(acquireDesktopPort);
      expect(failure._tag).toBe('DesktopBridgeError');
      expect(failure.reason).toBe('NotInElectron');
    }),
  );
});
