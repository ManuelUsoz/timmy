import { Effect } from 'effect';
import { SettingsRpcs } from '../../src/shared/settings/settings.rpc';
import { SettingsStore } from '../settings/settings-store';

export const layerSettingsHandlers = SettingsRpcs.toLayer(
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    return {
      'Settings.get': () => settings.get,
      'Settings.setLanguage': ({ language }) => settings.setLanguage(language),
      'Settings.setProvider': ({ provider, enabled }) => settings.setProvider(provider, enabled),
      'Settings.setChannel': ({ channel, change }) => settings.setChannel(channel, change),
      'Settings.setReader': ({ reader }) => settings.setReader(reader),
    };
  }),
);
