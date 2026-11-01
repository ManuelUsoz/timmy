import { Rpc, RpcGroup } from 'effect/rpc';
import { Language, Settings } from './settings.model';

/** User settings live in main. Storage failures are defects: no caller can act on them. */
export const SettingsRpcs = RpcGroup.make(
  Rpc.make('Settings.get', { success: Settings }),

  /** Stores the language and answers with the settings as they are afterwards. */
  Rpc.make('Settings.setLanguage', {
    payload: { language: Language },
    success: Settings,
  }),
);
