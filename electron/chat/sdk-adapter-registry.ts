import { Effect, Layer } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { makeClaudeAgentSdkAdapter } from './claude-agent-sdk-adapter';
import { SdkAdapterRegistry } from './sdk-adapter';

/** Every provider the app ships. Add a provider by building its adapter here. */
export const layerSdkAdapterRegistry = Layer.effect(
  SdkAdapterRegistry,
  Effect.gen(function* () {
    const claude = yield* makeClaudeAgentSdkAdapter();
    return SdkAdapterRegistry.of({
      defaultProvider: 'Claude',
      get: (provider) =>
        provider === 'Claude'
          ? Effect.succeed(claude)
          : Effect.fail(new ChatError({ reason: 'Unsupported', detail: `No adapter for provider ${provider}` })),
    });
  }),
);
