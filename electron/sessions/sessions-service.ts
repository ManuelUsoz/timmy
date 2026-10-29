import { Context, Effect, Layer, Option, Stream } from 'effect';
import { AgentId, SessionId } from '../../src/shared/chat/ids.model';
import { HistoryItem, SessionSummary, TranscriptRef } from '../../src/shared/sessions/sessions.model';
import { SessionsError } from '../../src/shared/sessions/sessions-error.model';
import { ChatRpc } from '../chat/chat-rpc';
import { SdkAdapterRegistry } from '../chat/sdk-adapter';
import { ProjectResolver } from './project-resolver';
import { SessionRepo } from './session-repo';

/** Stored sessions as the renderer sees them; live turns are `ChatRpc`. */
export class SessionsService extends Context.Service<
  SessionsService,
  {
    readonly list: (cwd: string) => Effect.Effect<ReadonlyArray<SessionSummary>>;
    readonly history: (ref: TranscriptRef) => Effect.Effect<ReadonlyArray<HistoryItem>, SessionsError>;
    readonly listSubagents: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<AgentId>, SessionsError>;
    readonly rename: (sessionId: SessionId, title: string) => Effect.Effect<void, SessionsError>;
    readonly delete: (sessionId: SessionId) => Effect.Effect<void, SessionsError>;
    /** Emits when the stored sessions changed; refetch `list`. */
    readonly changes: Stream.Stream<void>;
  }
>()('sessions/SessionsService') {}

export const layerSessionsService = Layer.effect(
  SessionsService,
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const resolver = yield* ProjectResolver;
    const registry = yield* SdkAdapterRegistry;
    const chat = yield* ChatRpc;

    const requireSession = Effect.fn('SessionsService.requireSession')(function* (sessionId: SessionId) {
      const session = yield* repo.get(sessionId);
      if (Option.isNone(session)) {
        return yield* new SessionsError({ reason: 'SessionNotFound', detail: `No stored session ${sessionId}` });
      }
      return session.value;
    });

    /** The adapter that wrote the session, whether or not it is the active one. A provider without one is a defect. */
    const adapterOf = (sessionId: SessionId) =>
      requireSession(sessionId).pipe(
        Effect.flatMap((session) => registry.get(session.provider).pipe(Effect.orDie)),
      );

    return SessionsService.of({
      changes: repo.changes,
      list: (cwd) => resolver.resolveByCwd(cwd).pipe(Effect.flatMap(repo.list)),
      history: (ref) => adapterOf(ref.sessionId).pipe(Effect.flatMap((adapter) => adapter.load(ref))),
      listSubagents: (sessionId) =>
        adapterOf(sessionId).pipe(Effect.flatMap((adapter) => adapter.listSubagentSession(sessionId))),
      rename: Effect.fn('SessionsService.rename')(function* (sessionId, title) {
        const trimmed = title.trim();
        if (trimmed === '') {
          return yield* new SessionsError({ reason: 'InvalidTitle', detail: 'A session title cannot be empty' });
        }
        yield* requireSession(sessionId);
        yield* repo.rename(sessionId, trimmed);
      }),
      delete: Effect.fn('SessionsService.delete')(function* (sessionId) {
        const adapter = yield* adapterOf(sessionId);
        if (yield* chat.isOpen(sessionId)) {
          return yield* new SessionsError({ reason: 'SessionActive', detail: `Session ${sessionId} is open` });
        }
        yield* adapter.delete(sessionId);
      }),
    });
  }),
);
