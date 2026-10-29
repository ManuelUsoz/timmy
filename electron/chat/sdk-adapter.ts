import { Context, Effect, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { SlashCommand } from '../../src/shared/chat/command.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { AgentId, SessionId } from '../../src/shared/chat/ids.model';
import { PermissionResponse } from '../../src/shared/chat/permission.model';
import { AdapterCapabilities, ModelInfo, ProviderId } from '../../src/shared/chat/provider.model';
import { QuestionResponse } from '../../src/shared/chat/question.model';
import { SessionOptions, UserMessage } from '../../src/shared/chat/session.model';
import {
  HistoryItem,
  ProjectId,
  ProviderSessionId,
  SessionSummary,
  TranscriptRef,
} from '../../src/shared/sessions/sessions.model';
import { TranscriptEntry } from '../sessions/session-repo';

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
  /** Slash commands available in `cwd`, including the user's and the project's own. No session is needed. */
  readonly listCommands: (options: { readonly cwd: string }) => Effect.Effect<ReadonlyArray<SlashCommand>, ChatError>;
  /**
   * Opens a session under Timmy's `ids.sessionId` and returns the id the SDK knows it by. With
   * `resumeProviderSessionId` the SDK continues that stored session.
   */
  readonly startSession: (
    options: SessionOptions,
    ids: { readonly sessionId: SessionId; readonly resumeProviderSessionId?: ProviderSessionId },
  ) => Effect.Effect<ProviderSessionId, ChatError>;
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

  // Stored sessions. Storage failures are defects. Past sessions stay readable whether or not
  // the adapter was started.

  /** Appends to a transcript. The SDK mirror and providers without one both write through this. */
  readonly append: (ref: TranscriptRef, entries: ReadonlyArray<TranscriptEntry>) => Effect.Effect<void>;
  /** The conversation of a transcript, decoded from the provider's native entries; empty if none. */
  readonly load: (ref: TranscriptRef) => Effect.Effect<ReadonlyArray<HistoryItem>>;
  readonly listSessions: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<SessionId>>;
  readonly listSessionMetadata: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<SessionSummary>>;
  /** Deletes the session and every transcript of it, subagents included. */
  readonly delete: (sessionId: SessionId) => Effect.Effect<void>;
  /** Subagents that have a stored transcript in the session. */
  readonly listSubagentSession: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<AgentId>>;
}

/** Every adapter the app can run, looked up by provider. Register new providers in its layer. */
export class SdkAdapterRegistry extends Context.Service<
  SdkAdapterRegistry,
  {
    readonly defaultProvider: ProviderId;
    readonly get: (provider: ProviderId) => Effect.Effect<SdkAdapter, ChatError>;
  }
>()('chat/SdkAdapterRegistry') {}
