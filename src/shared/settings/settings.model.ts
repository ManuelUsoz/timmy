import { Effect, Schema } from 'effect';

/** The language the Workspace is shown in. */
export const Language = Schema.Literals(['es', 'en']).annotate({ identifier: 'Language' });
export type Language = typeof Language.Type;

/** Spanish is the default until the user picks another language in Settings. */
export const defaultLanguage: Language = 'es';

/** An agent CLI Timmy can host. In order of support (ADR 0008). */
export const Provider = Schema.Literals(['OpenCode', 'ClaudeCode', 'Codex']).annotate({ identifier: 'Provider' });
export type Provider = typeof Provider.Type;

/** Every Provider, in the order Settings lists them. */
export const allProviders: ReadonlyArray<Provider> = Provider.literals;

/** The statuses a Channel can alert about. Working and Idle never alert (GLOSSARY: Channel). */
export const AlertType = Schema.Literals(['Waiting', 'Done', 'Error']).annotate({ identifier: 'AlertType' });
export type AlertType = typeof AlertType.Type;

/** Every alertable type, in the order Settings lists them. */
export const allAlertTypes: ReadonlyArray<AlertType> = AlertType.literals;

/** A Subscriber that alerts the user in some form (GLOSSARY: Channel). The Mascot is a Subscriber but not a Channel. */
export const Channel = Schema.Literals(['Toast']).annotate({ identifier: 'Channel' });
export type Channel = typeof Channel.Type;

/** Every Channel, in the order Settings lists them. */
export const allChannels: ReadonlyArray<Channel> = Channel.literals;

/** How the user configured one Channel: on or off, and which types it alerts for, in `allAlertTypes` order. */
export const ChannelSettings = Schema.Struct({ enabled: Schema.Boolean, types: Schema.Array(AlertType) }).annotate({ identifier: 'ChannelSettings' });
export type ChannelSettings = typeof ChannelSettings.Type;

/** A Channel the user has not touched alerts for every type. */
const alertsForAll: ChannelSettings = { enabled: true, types: allAlertTypes };

/** Each Channel's configuration. A file written before a Channel existed gets its default. Adding a Channel adds a key here. */
export const ChannelsSettings = Schema.Struct({
  Toast: ChannelSettings.pipe(Schema.withDecodingDefaultKey(Effect.succeed(alertsForAll))),
}).annotate({ identifier: 'ChannelsSettings' });
export type ChannelsSettings = typeof ChannelsSettings.Type;

export const defaultChannels: ChannelsSettings = { Toast: alertsForAll };

/** One change the user makes to a Channel: switch it on or off, or switch one of its types. */
export const ChannelChange = Schema.Union([
  Schema.TaggedStruct('Switch', { enabled: Schema.Boolean }),
  Schema.TaggedStruct('Type', { type: AlertType, enabled: Schema.Boolean }),
]).annotate({ identifier: 'ChannelChange' });
export type ChannelChange = typeof ChannelChange.Type;

/** The Channel after `change`; its types stay in `allAlertTypes` order. */
export const withChannelChange = (current: ChannelSettings, change: ChannelChange): ChannelSettings =>
  change._tag === 'Switch'
    ? { ...current, enabled: change.enabled }
    : { ...current, types: allAlertTypes.filter((type) => (type === change.type ? change.enabled : current.types.includes(type))) };

/**
 * How the file reader shows a file that has a drawn form (a Markdown page, an SVG picture): `rendered` (Renderizado,
 * Imagen for an SVG) or `source` (Fuente). One choice for every file, View and the Quick look; the last one wins.
 */
export const ReaderMode = Schema.Literals(['rendered', 'source']).annotate({ identifier: 'ReaderMode' });
export type ReaderMode = typeof ReaderMode.Type;

/** Everything the user can configure, stored by main so it survives restarts. */
export const Settings = Schema.Struct({
  language: Language,
  /** The Providers the user chose to use, in `allProviders` order. None until the user picks. */
  providers: Schema.Array(Provider).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** Each Channel's configuration; every Channel alerts for every type until the user says otherwise. */
  channels: ChannelsSettings.pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultChannels))),
  /** The reader's Renderizado/Fuente choice; Fuente until the user picks, so a file first shows its real text. */
  reader: ReaderMode.pipe(Schema.withDecodingDefaultKey(Effect.succeed('source' as const))),
}).annotate({ identifier: 'Settings' });
export type Settings = typeof Settings.Type;

export const defaultSettings: Settings = { language: defaultLanguage, providers: [], channels: defaultChannels, reader: 'source' };
