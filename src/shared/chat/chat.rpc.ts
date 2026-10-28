import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { ChatError } from './chat-error.model';
import { ChatEvent } from './event.model';
import { SessionId } from './ids.model';
import { PermissionResponse } from './permission.model';
import { AdapterCapabilities, ProviderId } from './provider.model';
import { QuestionResponse } from './question.model';
import { SessionOptions, UserMessage } from './session.model';

/**
 * Chat contract between renderer and main.
 *
 * `Chat.send` is a stream that ends after `TurnFinished`. While it is open the
 * agent may ask for a permission or answer a question; the renderer replies with
 * `Chat.resolvePermission` / `Chat.answerQuestion` on separate calls, matched by
 * request id.
 */
export const ChatRpcs = RpcGroup.make(
  /** Capabilities of the adapter that is active now. */
  Rpc.make('Chat.capabilities', { success: AdapterCapabilities }),

  /** Swap the active provider. Closes the open sessions; session ids do not carry over. */
  Rpc.make('Chat.changeAdapter', {
    payload: { provider: ProviderId },
    success: AdapterCapabilities,
    error: ChatError,
  }),

  Rpc.make('Chat.startSession', {
    payload: SessionOptions,
    success: SessionId,
    error: ChatError,
  }),

  /** Sends a user message and streams the turn's events until `TurnFinished`. */
  Rpc.make('Chat.send', {
    payload: UserMessage,
    success: ChatEvent,
    error: ChatError,
    stream: true,
  }),

  Rpc.make('Chat.resolvePermission', {
    payload: { sessionId: SessionId, response: PermissionResponse },
    success: Schema.Void,
    error: ChatError,
  }),

  Rpc.make('Chat.answerQuestion', {
    payload: { sessionId: SessionId, response: QuestionResponse },
    success: Schema.Void,
    error: ChatError,
  }),

  /** Cancels the running turn; the open `Chat.send` stream ends with `TurnFinished(Cancelled)`. */
  Rpc.make('Chat.interrupt', {
    payload: { sessionId: SessionId },
    success: Schema.Void,
    error: ChatError,
  }),

  Rpc.make('Chat.closeSession', {
    payload: { sessionId: SessionId },
    success: Schema.Void,
    error: ChatError,
  }),
);
