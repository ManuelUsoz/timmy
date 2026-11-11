import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Channel, ChannelChange, Language, Provider, ReaderMode, Settings } from './settings.model';

/** User settings live in main. Storage failures are defects: no caller can act on them. */
export const SettingsRpcs = RpcGroup.make(
  Rpc.make('Settings.get', { success: Settings }),

  /** Stores the language and answers with the settings as they are afterwards. */
  Rpc.make('Settings.setLanguage', {
    payload: { language: Language },
    success: Settings,
  }),

  /** Enables or disables one Provider and answers with the settings as they are afterwards. */
  Rpc.make('Settings.setProvider', {
    payload: { provider: Provider, enabled: Schema.Boolean },
    success: Settings,
  }),

  /**
   * Switches a Channel, or one of its types, and answers with the settings as they are afterwards. A change rather than
   * the whole Channel, so two quick changes never undo one another.
   */
  Rpc.make('Settings.setChannel', {
    payload: { channel: Channel, change: ChannelChange },
    success: Settings,
  }),

  /** Stores the reader's Renderizado/Fuente choice and answers with the settings as they are afterwards. */
  Rpc.make('Settings.setReader', {
    payload: { reader: ReaderMode },
    success: Settings,
  }),
);
