import { Effect, Layer } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { makeClaudeAgentSdkAdapter } from './claude-agent-sdk-adapter';
import { makeOpenCodeAdapter } from './opencode-adapter';
import { layerOpenCodeBackend } from './opencode-backend-live';
import { SdkAdapterRegistry } from './sdk-adapter';

/** Every provider the app ships. Add a provider by building its adapter here. */
export const layerSdkAdapterRegistry = Layer.effect(
  SdkAdapterRegistry,
  Effect.gen(function* () {
    const claude = yield* makeClaudeAgentSdkAdapter();
    const openCode = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerOpenCodeBackend));
    return SdkAdapterRegistry.of({
      defaultProvider: 'Claude',
      get: (provider) => {
        switch (provider) {
          case 'Claude':
            return Effect.succeed(claude);
          case 'OpenCode':
            return Effect.succeed(openCode);
          default:
            return Effect.fail(new ChatError({ reason: 'Unsupported', detail: `No adapter for provider ${provider}` }));
        }
      },
    });
  }),
);
