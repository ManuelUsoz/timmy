import { describe, expect, it } from '@effect/vitest';
import { randomUUID } from 'node:crypto';
import { Deferred, Effect, Fiber, Layer, Ref, Stream, type Scope } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import type { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId } from '../../src/shared/chat/ids.model';
import type { SessionOptions } from '../../src/shared/chat/session.model';
import { ProjectId, ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { makeOpenCodeAdapter } from './opencode-adapter';
import { OpenCodeBackend, type OpenCodeClient, type OpenCodeEvent, type OpenCodeModel } from './opencode-backend';
import type { SdkAdapter } from './sdk-adapter';

/** Counts of what the fake server did, so a test can see how often it started and stopped. */
interface ServerLog {
  readonly started: Ref.Ref<number>;
  readonly stopped: Ref.Ref<number>;
}

const makeServerLog = Effect.gen(function* () {
  return { started: yield* Ref.make(0), stopped: yield* Ref.make(0) } satisfies ServerLog;
});

const fakeClient = (
  models: ReadonlyArray<OpenCodeModel>,
  turn: OpenCodeClient['turn'] = () => Stream.empty,
  interrupt: OpenCodeClient['interrupt'] = () => Effect.void,
): OpenCodeClient => ({
  models: Effect.succeed(models),
  createSession: () => Effect.succeed('oc-session'),
  turn,
  interrupt,
});

/** A backend whose binary is present and whose server serves `client`; every start and stop is logged. */
const layerBackend = (log: ServerLog, client: OpenCodeClient) =>
  Layer.succeed(
    OpenCodeBackend,
    OpenCodeBackend.of({
      launch: Effect.acquireRelease(
        Ref.update(log.started, (n) => n + 1).pipe(Effect.as(client)),
        () => Ref.update(log.stopped, (n) => n + 1),
      ),
    }),
  );

const layerMissingBinary = Layer.succeed(
  OpenCodeBackend,
  OpenCodeBackend.of({
    launch: Effect.fail(
      new ChatError({
        reason: 'ProviderNotInstalled',
        detail: 'OpenCode is not installed. Install it and make sure `opencode` is on your PATH',
      }),
    ),
  }),
);

/** `it.effect` with an in-memory `SessionRepo`, which the adapter needs for its stored sessions. */
const itRepo = <E>(name: string, body: () => Effect.Effect<void, E, SessionRepo | Scope.Scope>) =>
  it.effect(name, () => body().pipe(Effect.provide(layerSessionRepo(':memory:'))));

const projectId = ProjectId.make('p1');
const options: SessionOptions = { provider: 'OpenCode', cwd: '/work', permissionMode: 'Default' };

/** Starts the adapter and opens a session the way `ChatRpc` does: start it, then store its row. */
const readySession = (log: ServerLog, client: OpenCodeClient) =>
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, client)));
    yield* adapter.startup;
    const sessionId = SessionId.make(randomUUID());
    const providerSessionId = yield* adapter.startSession(options, { sessionId });
    yield* repo.ensureProject(projectId, options.cwd);
    yield* repo.createSession({ sessionId, projectId, cwd: options.cwd, provider: 'OpenCode', providerSessionId });
    return { adapter, sessionId, providerSessionId };
  });

const say = (adapter: SdkAdapter, sessionId: SessionId, text: string) =>
  adapter.send({ sessionId, text, mentions: [], attachments: [] }).pipe(
    Stream.runCollect,
    Effect.map((events) => [...events]),
  );

const tags = (events: ReadonlyArray<ChatEvent>) => events.map((event) => event._tag);

const script =
  (...events: ReadonlyArray<OpenCodeEvent>): OpenCodeClient['turn'] =>
  () =>
    Stream.fromIterable(events);

describe('OpenCodeAdapter', () => {
  itRepo('runs one server for its lifetime, lists its models as vendor/model, and stops it on shutdown', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const models = [{ id: 'anthropic/claude-opus-5-5' }, { id: 'opencode/big-pickle' }];
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient(models))));
      yield* adapter.startup;
      expect(yield* adapter.models).toEqual([
        { id: 'anthropic/claude-opus-5-5', efforts: ['Default'] },
        { id: 'opencode/big-pickle', efforts: ['Default'] },
      ]);
      expect(yield* Ref.get(log.started)).toBe(1);
      expect(yield* Ref.get(log.stopped)).toBe(0);
      yield* adapter.shutdown;
      expect(yield* Ref.get(log.stopped)).toBe(1);
    }));

  itRepo('has no models before it is started', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([{ id: 'a/b' }]))));
      const error = yield* adapter.models.pipe(Effect.flip);
      expect(error.reason).toBe('AdapterNotReady');
    }));

  itRepo('refuses to start when opencode is not installed', () =>
    Effect.gen(function* () {
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerMissingBinary));
      const error = yield* adapter.startup.pipe(Effect.flip);
      expect(error.reason).toBe('ProviderNotInstalled');
    }));

  itRepo('refuses to start when OpenCode has no usable model, and stops the server it started', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([]))));
      const error = yield* adapter.startup.pipe(Effect.flip);
      expect(error.reason).toBe('AuthMissing');
      expect(yield* Ref.get(log.stopped)).toBe(1);
    }));

  itRepo("streams a text turn, then remembers it in Timmy's transcript", () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const client = fakeClient(
        [{ id: 'opencode/big-pickle' }],
        script({ _tag: 'TextDelta', text: 'Hel' }, { _tag: 'TextDelta', text: 'lo' }, { _tag: 'Idle' }),
      );
      const { adapter, sessionId, providerSessionId } = yield* readySession(log, client);
      expect(providerSessionId).toBe('oc-session');

      const events = yield* say(adapter, sessionId, 'hi');

      expect(tags(events)).toEqual(['TurnStarted', 'MessageDelta', 'MessageDelta', 'TurnFinished']);
      expect(events.flatMap((event) => (event._tag === 'MessageDelta' ? [event.text] : []))).toEqual(['Hel', 'lo']);
      const finished = events.at(-1);
      expect(finished?._tag === 'TurnFinished' ? finished.outcome : undefined).toBe('Completed');

      const history = yield* adapter.load({ projectId, sessionId });
      expect(history).toMatchObject([
        { _tag: 'Message', role: 'User', text: 'hi' },
        { _tag: 'Message', role: 'Assistant', text: 'Hello' },
      ]);
    }));

  itRepo('ends a failed turn with Failed and a readable detail', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const client = fakeClient(
        [{ id: 'opencode/big-pickle' }],
        script({ _tag: 'TextDelta', text: 'Par' }, { _tag: 'Failed', detail: 'Rate limit reached' }),
      );
      const { adapter, sessionId } = yield* readySession(log, client);

      const events = yield* say(adapter, sessionId, 'hi');

      expect(tags(events)).toEqual(['TurnStarted', 'MessageDelta', 'TurnFinished']);
      const finished = events.at(-1);
      expect(finished?._tag === 'TurnFinished' ? [finished.outcome, finished.detail] : undefined).toEqual([
        'Failed',
        'Rate limit reached',
      ]);
    }));

  itRepo('interrupting a running turn ends it with Cancelled', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const gate = yield* Deferred.make<void>();
      const speaking = yield* Deferred.make<void>();
      const interrupted = yield* Ref.make<ReadonlyArray<string>>([]);
      const client = fakeClient(
        [{ id: 'opencode/big-pickle' }],
        () =>
          Stream.make<OpenCodeEvent[]>({ _tag: 'TextDelta', text: 'Thinking...' }).pipe(
            Stream.tap(() => Deferred.succeed(speaking, undefined)),
            Stream.concat(
              Stream.fromEffect(Deferred.await(gate)).pipe(Stream.map((): OpenCodeEvent => ({ _tag: 'Idle' }))),
            ),
          ),
        (id) => Ref.update(interrupted, (all) => [...all, id]).pipe(Effect.andThen(Deferred.succeed(gate, undefined))),
      );
      const { adapter, sessionId, providerSessionId } = yield* readySession(log, client);

      const turn = yield* Effect.forkChild(say(adapter, sessionId, 'hi'));
      yield* Deferred.await(speaking);
      yield* adapter.interrupt(sessionId);
      const events = yield* Fiber.join(turn);

      const finished = events.at(-1);
      expect(finished?._tag === 'TurnFinished' ? finished.outcome : undefined).toBe('Cancelled');
      expect(yield* Ref.get(interrupted)).toEqual([providerSessionId]);
    }));

  itRepo('loads and lists a stored transcript without starting the adapter', () =>
    Effect.gen(function* () {
      const repo = yield* SessionRepo;
      const sessionId = SessionId.make(randomUUID());
      yield* repo.ensureProject(projectId, options.cwd);
      yield* repo.createSession({
        sessionId,
        projectId,
        cwd: options.cwd,
        provider: 'OpenCode',
        providerSessionId: ProviderSessionId.make('oc-old'),
      });
      yield* repo.append({ projectId, sessionId }, [
        { kind: 'user', uuid: 'u1', native: { role: 'user', text: 'earlier question' } },
        { kind: 'assistant', uuid: 'a1', native: { role: 'assistant', text: 'earlier answer' } },
        { kind: 'noise', uuid: 'n1', native: { something: 'else' } },
      ]);
      const log = yield* makeServerLog;
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([]))));

      expect(yield* adapter.listSessions(projectId)).toEqual([sessionId]);
      expect(yield* adapter.load({ projectId, sessionId })).toMatchObject([
        { _tag: 'Message', role: 'User', text: 'earlier question' },
        { _tag: 'Message', role: 'Assistant', text: 'earlier answer' },
      ]);
      expect(yield* Ref.get(log.started)).toBe(0);
    }));

  itRepo('only claims what it can do so far', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([]))));
      expect(adapter.capabilities).toEqual({
        provider: 'OpenCode',
        subagents: false,
        toolCalls: false,
        permissions: false,
        questions: false,
        thinking: false,
        resume: false,
        images: false,
        mentions: 'none',
      });
    }));

  itRepo('keeps the partial answer when the consumer stops listening mid-turn', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const speaking = yield* Deferred.make<void>();
      const client = fakeClient([{ id: 'opencode/big-pickle' }], () =>
        Stream.make<OpenCodeEvent[]>({ _tag: 'TextDelta', text: 'Half an ans' }).pipe(Stream.concat(Stream.never)),
      );
      const { adapter, sessionId } = yield* readySession(log, client);

      // The consumer, not the source, says when the delta arrived: only then is it part of the answer.
      const turn = yield* Effect.forkChild(
        adapter.send({ sessionId, text: 'hi', mentions: [], attachments: [] }).pipe(
          Stream.tap((event) => (event._tag === 'MessageDelta' ? Deferred.succeed(speaking, undefined) : Effect.void)),
          Stream.runDrain,
        ),
      );
      yield* Deferred.await(speaking);
      yield* Fiber.interrupt(turn);

      expect(yield* adapter.load({ projectId, sessionId })).toMatchObject([
        { _tag: 'Message', role: 'User', text: 'hi' },
        { _tag: 'Message', role: 'Assistant', text: 'Half an ans' },
      ]);
    }));

  itRepo('forgets its open sessions when it starts again, since the new server does not know them', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const { adapter, sessionId } = yield* readySession(log, fakeClient([{ id: 'opencode/big-pickle' }]));

      yield* adapter.startup;

      const error = yield* say(adapter, sessionId, 'hi').pipe(Effect.flip);
      expect(error.reason).toBe('SessionNotFound');
    }));
});
