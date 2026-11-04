import { Effect } from 'effect';
import { HooksRpcs } from '../../src/shared/hooks/hooks.rpc';
import { HooksService } from '../hooks/hooks-service';

export const layerHooksHandlers = HooksRpcs.toLayer(
  Effect.gen(function* () {
    const hooks = yield* HooksService;
    return {
      'Hooks.list': () => hooks.list,
      'Hooks.setActive': ({ provider, active }) => hooks.setActive(provider, active),
    };
  }),
);
