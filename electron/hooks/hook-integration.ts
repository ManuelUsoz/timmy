import type { Effect, Option } from 'effect';
import type { HooksError } from '../../src/shared/hooks/hooks-error.model';
import type { HookSignal } from '../../src/shared/hooks/hooks.model';
import type { Provider } from '../../src/shared/settings/settings.model';

/**
 * The strategy for one Provider's Hook (the glossary's Integration, hook side). Shared code (Settings, the local
 * channel, the Terminal's activity) only talks to this interface and never branches on the Provider.
 */
export interface HookIntegration {
  readonly provider: Provider;
  /** Whether Timmy's entries are in the Provider's config. */
  readonly isActive: Effect.Effect<boolean, HooksError>;
  /** Writes Timmy's entries into the Provider's config. Idempotent; touches nothing else. */
  readonly activate: Effect.Effect<void, HooksError>;
  /** Removes exactly the entries `activate` wrote. */
  readonly deactivate: Effect.Effect<void, HooksError>;
  /** Reads what the Hook posted. `None` for events that say nothing about the Terminal's status. */
  readonly decode: (payload: unknown) => Option.Option<HookSignal>;
}
