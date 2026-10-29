import { Context, Effect, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId } from '../../src/shared/chat/ids.model';
import { PermissionResponse } from '../../src/shared/chat/permission.model';
import { AdapterCapabilities, ModelInfo, ProviderId } from '../../src/shared/chat/provider.model';
import { QuestionResponse } from '../../src/shared/chat/question.model';
import { SessionOptions, UserMessage } from '../../src/shared/chat/session.model';

/**
 * One LLM provider SDK behind the provider-neutral chat domain. An adapter
 * translates the SDK's native events into `ChatEvent`s and owns its sessions.
 * Failures a caller cannot act on become defects inside the adapter.
 */
export interface SdkAdapter {
  readonly capabilities: AdapterCapabilities;
  /** Prepares the SDK (auth, binaries). `ChatRpc` runs it at most once per adapter instance. */
  readonly startup: Effect.Effect<void, ChatError>;
  /** Releases what `startup` acquired. Called when the adapter is swapped out. */
  readonly shutdown: Effect.Effect<void>;
  /** Models this provider offers. */
  readonly models: Effect.Effect<ReadonlyArray<ModelInfo>, ChatError>;
  readonly startSession: (options: SessionOptions) => Effect.Effect<SessionId, ChatError>;
  /** Streams the events of one turn; ends after `TurnFinished`. */
  readonly send: (message: UserMessage) => Stream.Stream<ChatEvent, ChatError>;
  readonly resolvePermission: (
    sessionId: SessionId,
    response: PermissionResponse,
  ) => Effect.Effect<void, ChatError>;
  readonly answerQuestion: (
    sessionId: SessionId,
    response: QuestionResponse,
  ) => Effect.Effect<void, ChatError>;
  /** Cancels the running turn; its `send` stream finishes with `TurnFinished(Cancelled)`. */
  readonly interrupt: (sessionId: SessionId) => Effect.Effect<void, ChatError>;
  readonly closeSession: (sessionId: SessionId) => Effect.Effect<void, ChatError>;
}

/** Every adapter the app can run, looked up by provider. Register new providers in its layer. */
export class SdkAdapterRegistry extends Context.Service<
  SdkAdapterRegistry,
  {
    readonly defaultProvider: ProviderId;
    readonly get: (provider: ProviderId) => Effect.Effect<SdkAdapter, ChatError>;
  }
>()('chat/SdkAdapterRegistry') {}
