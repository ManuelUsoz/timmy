import { randomUUID } from 'node:crypto';
import { Context, Effect, Layer, Option, Ref, Semaphore, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { SlashCommand } from '../../src/shared/chat/command.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId } from '../../src/shared/chat/ids.model';
import { PermissionResponse } from '../../src/shared/chat/permission.model';
import { AdapterCapabilities, ModelInfo, ProviderId } from '../../src/shared/chat/provider.model';
import { QuestionResponse } from '../../src/shared/chat/question.model';
import { SessionOptions, UserMessage } from '../../src/shared/chat/session.model';
import { ProjectResolver } from '../sessions/project-resolver';
import { SessionObserver } from '../sessions/session-observer';
import { SessionRepo } from '../sessions/session-repo';
import { SdkAdapter, SdkAdapterRegistry } from './sdk-adapter';

export interface ChatRpcShape {
  /** Starts the active adapter. Idempotent; every other call also triggers it lazily. */
  readonly startup: Effect.Effect<void, ChatError>;
  readonly capabilities: Effect.Effect<AdapterCapabilities>;
  readonly models: Effect.Effect<ReadonlyArray<ModelInfo>, ChatError>;
  readonly commands: (cwd: string) => Effect.Effect<ReadonlyArray<SlashCommand>, ChatError>;
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
  /** Whether the session is open on the active adapter. */
  readonly isOpen: (sessionId: SessionId) => Effect.Effect<boolean>;
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
    const repo = yield* SessionRepo;
    const resolver = yield* ProjectResolver;
    const observer = yield* SessionObserver;
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

    /** The stored session `resume` points at, if the active adapter can continue it. */
    const findResumable = Effect.fn('ChatRpc.findResumable')(function* (adapter: SdkAdapter, resume: SessionId) {
      const stored = yield* repo.get(resume);
      if (Option.isNone(stored)) {
        return yield* new ChatError({ reason: 'SessionNotFound', detail: `No stored session ${resume}` });
      }
      if (stored.value.provider !== adapter.capabilities.provider || !adapter.capabilities.resume) {
        return yield* new ChatError({
          reason: 'Unsupported',
          detail: `Session ${resume} cannot be resumed with ${adapter.capabilities.provider}`,
        });
      }
      return stored.value;
    });

    const startSession = Effect.fn('ChatRpc.startSession')(function* (options: SessionOptions) {
      const adapter = yield* ready;
      if (options.provider !== adapter.capabilities.provider) {
        return yield* new ChatError({
          reason: 'Unsupported',
          detail: `Active adapter is ${adapter.capabilities.provider}, not ${options.provider}; call changeAdapter first`,
        });
      }
      const resumed = options.resume === undefined ? undefined : yield* findResumable(adapter, options.resume);
      const sessionId = resumed?.sessionId ?? SessionId.make(randomUUID());
      // Starting it again would replace the live runtime and orphan its pending requests.
      if (resumed !== undefined && (yield* Ref.get(state)).sessions.has(sessionId)) {
        return sessionId;
      }
      const providerSessionId = yield* adapter.startSession(options, {
        sessionId,
        ...(resumed === undefined ? {} : { resumeProviderSessionId: resumed.providerSessionId }),
      });
      if (resumed === undefined) {
        const projectId = yield* resolver.resolveByCwd(options.cwd);
        yield* repo.createSession({
          sessionId,
          projectId,
          cwd: options.cwd,
          provider: options.provider,
          providerSessionId,
        });
      }
      yield* Ref.update(state, (s) => ({ ...s, sessions: new Set(s.sessions).add(sessionId) }));
      return sessionId;
    });

    const closeSession = Effect.fn('ChatRpc.closeSession')(function* (sessionId: SessionId) {
      const adapter = yield* requireSession(sessionId);
      yield* adapter.closeSession(sessionId);
      yield* observer.forget(sessionId);
      yield* Ref.update(state, (s) => {
        const sessions = new Set(s.sessions);
        sessions.delete(sessionId);
        return { ...s, sessions };
      });
    });

    return ChatRpc.of({
      startup: ready.pipe(Effect.asVoid),
      capabilities: Ref.get(state).pipe(Effect.map((s) => s.active.adapter.capabilities)),
      models: ready.pipe(Effect.flatMap((adapter) => adapter.models)),
      commands: (cwd) => ready.pipe(Effect.flatMap((adapter) => adapter.listCommands({ cwd }))),
      changeAdapter: (provider) => swapLock.withPermit(changeAdapter(provider)),
      startSession: (options) => swapLock.withPermit(startSession(options)),
      send: (message) =>
        Stream.unwrap(
          requireSession(message.sessionId).pipe(
            Effect.tap(() => observer.userMessage(message)),
            Effect.map((adapter) => adapter.send(message).pipe(Stream.tap(observer.event))),
          ),
        ),
      isOpen: (sessionId) => Ref.get(state).pipe(Effect.map((s) => s.sessions.has(sessionId))),
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
