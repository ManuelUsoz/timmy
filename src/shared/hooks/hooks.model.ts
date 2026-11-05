import { Schema } from 'effect';
import { Provider } from '../settings/settings.model';

/**
 * What a Provider's Hook can report about a Terminal, whatever the Provider. Each Integration translates its own events
 * into these. `Ended` means the Provider's session is over, so the Terminal falls back to its process and output.
 */
export const HookSignal = Schema.Literals(['Working', 'Waiting', 'Done', 'Ended']).annotate({ identifier: 'HookSignal' });
export type HookSignal = typeof HookSignal.Type;

/** The signals that say what the agent is doing; `Ended` only says the Hook stopped reporting. */
export type HookReportedStatus = Exclude<HookSignal, 'Ended'>;

/** The names every Provider's Hook and Timmy agree on (ADR 0009). An Integration never spells them out itself. */
export const HookConstants = {
  /** Set in the environment of every Terminal Timmy starts; a Hook does nothing when it is empty or absent. */
  terminalIdEnv: 'TIMMY_TERMINAL_ID',
  /** Where a Terminal's Hook posts, without the Provider (the Hook appends its own). */
  urlEnv: 'TIMMY_HOOK_URL',
  /** Carried by every entry Timmy writes into a Provider's config, so deactivating removes only Timmy's entries. */
  marker: '# timmy-hook',
} as const;

/** One Provider that has a Hook, as Settings → Hooks shows it. */
export const HookStatus = Schema.Struct({
  provider: Provider,
  /** The Provider is enabled in Settings; only then can its Hook be activated. */
  enabled: Schema.Boolean,
  /** Timmy's entries are in the Provider's config. */
  active: Schema.Boolean,
}).annotate({ identifier: 'HookStatus' });
export type HookStatus = typeof HookStatus.Type;
