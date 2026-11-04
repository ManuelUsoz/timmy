import { Schema } from 'effect';
import { Provider } from '../settings/settings.model';

/** One Provider that has a Hook, as Settings → Hooks shows it. */
export const HookStatus = Schema.Struct({
  provider: Provider,
  /** The Provider is enabled in Settings; only then can its Hook be activated. */
  enabled: Schema.Boolean,
  /** Timmy's entries are in the Provider's config. */
  active: Schema.Boolean,
}).annotate({ identifier: 'HookStatus' });
export type HookStatus = typeof HookStatus.Type;
