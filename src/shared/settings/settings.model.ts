import { Schema } from 'effect';

/** The language the Workspace is shown in. */
export const Language = Schema.Literals(['es', 'en']).annotate({ identifier: 'Language' });
export type Language = typeof Language.Type;

/** Spanish is the default until the user picks another language in Settings. */
export const defaultLanguage: Language = 'es';

/** Everything the user can configure, stored by main so it survives restarts. */
export const Settings = Schema.Struct({
  language: Language,
}).annotate({ identifier: 'Settings' });
export type Settings = typeof Settings.Type;

export const defaultSettings: Settings = { language: defaultLanguage };
