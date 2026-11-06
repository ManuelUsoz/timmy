import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import { makeDesktopTestLayer } from '../../src/app/core/desktop-layers';
import { defaultSettings } from '../../src/shared/settings/settings.model';
import { layerSettingsStoreTest } from '../settings/settings-store';
import { layerSettingsHandlers } from './settings';

const layer = makeDesktopTestLayer(layerSettingsHandlers.pipe(Layer.provide(layerSettingsStoreTest())));

describe('Settings RPCs', () => {
  it.effect('reads the toast Channel on for Waiting, Done and Error by default', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Settings.get']()).toEqual(defaultSettings);
      expect((yield* api['Settings.get']()).channels.Toast).toEqual({ enabled: true, types: ['Waiting', 'Done', 'Error'] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect('switches a Channel and one of its types, answering with the settings afterwards', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      const off = yield* api['Settings.setChannel']({ channel: 'Toast', change: { _tag: 'Switch', enabled: false } });
      expect(off.channels.Toast).toEqual({ enabled: false, types: ['Waiting', 'Done', 'Error'] });
      const noDone = yield* api['Settings.setChannel']({ channel: 'Toast', change: { _tag: 'Type', type: 'Done', enabled: false } });
      expect(noDone.channels.Toast).toEqual({ enabled: false, types: ['Waiting', 'Error'] });
      expect((yield* api['Settings.get']()).channels.Toast).toEqual({ enabled: false, types: ['Waiting', 'Error'] });
    }).pipe(Effect.provide(layer)),
  );
});
