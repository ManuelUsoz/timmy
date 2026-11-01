import { Effect } from 'effect';
import { SettingsRpcs } from '../../src/shared/settings/settings.rpc';
import { SettingsStore } from '../settings/settings-store';

export const layerSettingsHandlers = SettingsRpcs.toLayer(
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    return {
      'Settings.get': () => settings.get,
      'Settings.setLanguage': ({ language }) => settings.setLanguage(language),
    };
  }),
);
