import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Layer, Option, Stream } from 'effect';
import { AgentId, SessionId } from '../../src/shared/chat/ids.model';
import { ProviderSessionId, type TranscriptRef } from '../../src/shared/sessions/sessions.model';
import { ChatRpc } from '../chat/chat-rpc';
import { claudeHistory } from '../chat/claude-history-mapper';
import { SdkAdapter, SdkAdapterRegistry } from '../chat/sdk-adapter';
import { layerProjectResolver, ProjectResolver } from './project-resolver';
import { layerSessionRepo, SessionRepo } from './session-repo';
import { layerSessionsService, SessionsService } from './sessions-service';

/** Adapter stand-in: only the stored-session operations, over the real repo. */
const layerRegistry = Layer.effect(
  SdkAdapterRegistry,
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const stored: Pick<SdkAdapter, 'load' | 'listSubagentSession' | 'delete'> = {
      load: (ref: TranscriptRef) =>
        repo.load(ref).pipe(Effect.map(Option.match({ onNone: () => [], onSome: claudeHistory }))),
      listSubagentSession: repo.subagents,
      delete: repo.remove,
    };
    return SdkAdapterRegistry.of({
      defaultProvider: 'Claude',
      get: () => Effect.succeed(stored as SdkAdapter),
    });
  }),
);

const layerChat = (open: ReadonlySet<SessionId>) =>
  Layer.succeed(ChatRpc, { isOpen: (id: SessionId) => Effect.succeed(open.has(id)) } as ChatRpc['Service']);

const makeLayer = (open: ReadonlySet<SessionId> = new Set()) =>
  layerSessionsService.pipe(
    Layer.provideMerge(Layer.mergeAll(layerProjectResolver, layerRegistry, layerChat(open))),
    Layer.provideMerge(layerSessionRepo(':memory:')),
  );

const seeded = Effect.gen(function* () {
  const repo = yield* SessionRepo;
  const projectId = yield* (yield* ProjectResolver).resolveByCwd('/work');
  const sessionId = SessionId.make('s1');
  yield* repo.createSession({
    sessionId,
    projectId,
    cwd: '/work',
    provider: 'Claude',
    providerSessionId: ProviderSessionId.make('native'),
  });
  yield* repo.append({ projectId, sessionId }, [
    { kind: 'user', uuid: 'u1', native: { type: 'user', message: { content: 'hello' } } },
  ]);
  yield* repo.append({ projectId, sessionId, subagent: AgentId.make('a1') }, [
    { kind: 'assistant', uuid: 'u2', native: { type: 'assistant', message: { content: 'from agent' } } },
  ]);
  return { projectId, sessionId };
});

describe('SessionsService', () => {
  it.effect('lists the sessions of a cwd, reads their history and their subagents', () =>
    Effect.gen(function* () {
      const { projectId, sessionId } = yield* seeded;
      const sessions = yield* SessionsService;
      expect((yield* sessions.list('/work')).map((s) => s.sessionId)).toEqual([sessionId]);
      expect(yield* sessions.list('/elsewhere')).toEqual([]);
      expect(yield* sessions.history({ projectId, sessionId })).toEqual([
        { _tag: 'Message', role: 'User', text: 'hello' },
      ]);
      const agent = AgentId.make('a1');
      expect(yield* sessions.listSubagents(sessionId)).toEqual([agent]);
      expect(yield* sessions.history({ projectId, sessionId, subagent: agent })).toEqual([
        { _tag: 'Message', role: 'Assistant', text: 'from agent' },
      ]);
    }).pipe(Effect.provide(makeLayer())));

  it.effect('renames and deletes a stored session', () =>
    Effect.gen(function* () {
      const { sessionId } = yield* seeded;
      const sessions = yield* SessionsService;
      yield* sessions.rename(sessionId, 'Renamed');
      expect((yield* sessions.list('/work')).map((s) => s.title)).toEqual(['Renamed']);
      yield* sessions.delete(sessionId);
      expect(yield* sessions.list('/work')).toEqual([]);
    }).pipe(Effect.provide(makeLayer())));

  it.effect('pushes a change when a session is renamed', () =>
    Effect.gen(function* () {
      const { sessionId } = yield* seeded;
      const sessions = yield* SessionsService;
      const pushed = yield* sessions.changes.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* sessions.rename(sessionId, 'Renamed');
      expect(yield* Fiber.join(pushed)).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(makeLayer())));

  it.effect('reports a session that is not stored', () =>
    Effect.gen(function* () {
      const sessions = yield* SessionsService;
      const error = yield* sessions.rename(SessionId.make('nope'), 'x').pipe(Effect.flip);
      expect(error.reason).toBe('SessionNotFound');
    }).pipe(Effect.provide(makeLayer())));

  it.effect('refuses to delete a session that is open', () =>
    Effect.gen(function* () {
      const { sessionId } = yield* seeded;
      const sessions = yield* SessionsService;
      const error = yield* sessions.delete(sessionId).pipe(Effect.flip);
      expect(error.reason).toBe('SessionActive');
      expect(yield* sessions.list('/work')).toHaveLength(1);
    }).pipe(Effect.provide(makeLayer(new Set([SessionId.make('s1')])))));
});
