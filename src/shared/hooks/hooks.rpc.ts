import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Provider } from '../settings/settings.model';
import { HooksError } from './hooks-error.model';
import { HookStatus } from './hooks.model';

export const HooksRpcs = RpcGroup.make(
  /** The Providers that have a Hook and are enabled or already active, in Settings order. */
  Rpc.make('Hooks.list', {
    success: Schema.Array(HookStatus),
    error: HooksError,
  }),

  /** Activates or deactivates one Provider's Hook and answers with the list as it is afterwards. */
  Rpc.make('Hooks.setActive', {
    payload: { provider: Provider, active: Schema.Boolean },
    success: Schema.Array(HookStatus),
    error: HooksError,
  }),
);
