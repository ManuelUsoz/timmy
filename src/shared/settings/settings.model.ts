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

/** Everything the user can configure, stored by main so it survives restarts. */
export const Settings = Schema.Struct({
  language: Language,
  /** The Providers the user chose to use, in `allProviders` order. None until the user picks. */
  providers: Schema.Array(Provider).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).annotate({ identifier: 'Settings' });
export type Settings = typeof Settings.Type;

export const defaultSettings: Settings = { language: defaultLanguage, providers: [] };
