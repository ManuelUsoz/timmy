import { Context, Effect, Layer, Ref, Semaphore, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId } from '../../src/shared/chat/ids.model';
import { PermissionResponse } from '../../src/shared/chat/permission.model';
import { AdapterCapabilities, ProviderId } from '../../src/shared/chat/provider.model';
import { QuestionResponse } from '../../src/shared/chat/question.model';
import { SessionOptions, UserMessage } from '../../src/shared/chat/session.model';
import { SdkAdapter, SdkAdapterRegistry } from './sdk-adapter';

export interface ChatRpcShape {
  /** Starts the active adapter. Idempotent; every other call also triggers it lazily. */
  readonly startup: Effect.Effect<void, ChatError>;
  readonly capabilities: Effect.Effect<AdapterCapabilities>;
  readonly changeAdapter: (provider: ProviderId) => Effect.Effect<AdapterCapabilities, ChatError>;
  readonly startSession: (options: SessionOptions) => Effect.Effect<SessionId, ChatError>;
  readonly send: (message: UserMessage) => Stream.Stream<ChatEvent, ChatError>;
  readonly resolvePermission: (
    sessionId: SessionId,
    response: PermissionResponse,
  ) => Effect.Effect<void, ChatError>;
  readonly answerQuestion: (
    sessionId: SessionId,
    response: QuestionResponse,
  ) => Effect.Effect<void, ChatError>;
  readonly interrupt: (sessionId: SessionId) => Effect.Effect<void, ChatError>;
  readonly closeSession: (sessionId: SessionId) => Effect.Effect<void, ChatError>;
}

/**
 * Renderer-facing chat service: holds the active `SdkAdapter`, tracks which
 * sessions are open on it, and swaps adapters on `changeAdapter`.
 */
export class ChatRpc extends Context.Service<ChatRpc, ChatRpcShape>()('chat/ChatRpc') {}

interface Active {
  readonly adapter: SdkAdapter;
  /** Memoized `adapter.startup`: runs once, later callers reuse the result. */
  readonly started: Effect.Effect<void, ChatError>;
}

interface State {
  readonly active: Active;
  readonly sessions: ReadonlySet<SessionId>;
}

const makeActive = (adapter: SdkAdapter) =>
  Effect.cached(adapter.startup).pipe(Effect.map((started): Active => ({ adapter, started })));

export const layerChatRpc = Layer.effect(
  ChatRpc,
  Effect.gen(function* () {
    const registry = yield* SdkAdapterRegistry;
    const initial = yield* registry.get(registry.defaultProvider).pipe(Effect.flatMap(makeActive), Effect.orDie);
    const state = yield* Ref.make<State>({ active: initial, sessions: new Set<SessionId>() });
    const swapLock = yield* Semaphore.make(1);

    const ready = Effect.gen(function* () {
      const { active } = yield* Ref.get(state);
      yield* active.started;
      return active.adapter;
    });

    const requireSession = Effect.fn('ChatRpc.requireSession')(function* (sessionId: SessionId) {
      const { sessions } = yield* Ref.get(state);
      if (!sessions.has(sessionId)) {
        return yield* new ChatError({ reason: 'SessionNotFound', detail: `No open session ${sessionId}` });
      }
      return yield* ready;
    });

    const changeAdapter = Effect.fn('ChatRpc.changeAdapter')(function* (provider: ProviderId) {
      const current = yield* Ref.get(state);
      if (current.active.adapter.capabilities.provider === provider) {
        return current.active.adapter.capabilities;
      }
      const next = yield* registry.get(provider).pipe(Effect.flatMap(makeActive));
      yield* next.started;
      const previous = yield* Ref.getAndSet(state, { active: next, sessions: new Set<SessionId>() });
      yield* Effect.forEach(
        previous.sessions,
        (sessionId) => previous.active.adapter.closeSession(sessionId).pipe(Effect.ignore),
        { discard: true },
      );
      yield* previous.active.adapter.shutdown;
      return next.adapter.capabilities;
    });

    const startSession = Effect.fn('ChatRpc.startSession')(function* (options: SessionOptions) {
      const adapter = yield* ready;
      if (options.provider !== adapter.capabilities.provider) {
        return yield* new ChatError({
          reason: 'Unsupported',
          detail: `Active adapter is ${adapter.capabilities.provider}, not ${options.provider}; call changeAdapter first`,
        });
      }
      const sessionId = yield* adapter.startSession(options);
      yield* Ref.update(state, (s) => ({ ...s, sessions: new Set(s.sessions).add(sessionId) }));
      return sessionId;
    });

    const closeSession = Effect.fn('ChatRpc.closeSession')(function* (sessionId: SessionId) {
      const adapter = yield* requireSession(sessionId);
      yield* adapter.closeSession(sessionId);
      yield* Ref.update(state, (s) => {
        const sessions = new Set(s.sessions);
        sessions.delete(sessionId);
        return { ...s, sessions };
      });
    });

    return ChatRpc.of({
      startup: ready.pipe(Effect.asVoid),
      capabilities: Ref.get(state).pipe(Effect.map((s) => s.active.adapter.capabilities)),
      changeAdapter: (provider) => swapLock.withPermit(changeAdapter(provider)),
      startSession: (options) => swapLock.withPermit(startSession(options)),
      send: (message) =>
        Stream.unwrap(requireSession(message.sessionId).pipe(Effect.map((adapter) => adapter.send(message)))),
      resolvePermission: (sessionId, response) =>
        requireSession(sessionId).pipe(Effect.flatMap((adapter) => adapter.resolvePermission(sessionId, response))),
      answerQuestion: (sessionId, response) =>
        requireSession(sessionId).pipe(Effect.flatMap((adapter) => adapter.answerQuestion(sessionId, response))),
      interrupt: (sessionId) =>
        requireSession(sessionId).pipe(Effect.flatMap((adapter) => adapter.interrupt(sessionId))),
      closeSession,
    });
  }),
);
