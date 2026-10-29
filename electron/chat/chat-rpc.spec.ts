import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Ref, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { ProviderId } from '../../src/shared/chat/provider.model';
import { SessionOptions } from '../../src/shared/chat/session.model';
import { ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { layerProjectResolver } from '../sessions/project-resolver';
import { layerSessionObserver } from '../sessions/session-observer';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { ChatRpc, layerChatRpc } from './chat-rpc';
import { SdkAdapter, SdkAdapterRegistry } from './sdk-adapter';

const options = (provider: ProviderId): SessionOptions => ({ provider, cwd: '/work', permissionMode: 'Default' });

interface StartedSession {
  readonly sessionId: SessionId;
  readonly resumeProviderSessionId?: ProviderSessionId;
}

interface Calls {
  readonly startups: Ref.Ref<number>;
  readonly closed: Ref.Ref<ReadonlyArray<SessionId>>;
  readonly shutdowns: Ref.Ref<number>;
  readonly started: Ref.Ref<ReadonlyArray<StartedSession>>;
}

/** Test double for the SDK boundary: counts lifecycle calls and replays one scripted turn. */
const makeFakeAdapter = (provider: ProviderId, calls: Calls): SdkAdapter => {
  const unused = Effect.void;
  return {
    capabilities: {
      provider,
      subagents: true,
      toolCalls: true,
      permissions: true,
      questions: true,
      thinking: false,
      resume: true,
    },
    startup: Ref.update(calls.startups, (n) => n + 1),
    shutdown: Ref.update(calls.shutdowns, (n) => n + 1),
    models: Effect.succeed([{ id: `${provider}-model`, efforts: ['Default'] }]),
    listCommands: ({ cwd }) =>
      Effect.succeed([{ name: `${provider}-cmd`, description: cwd, argumentHint: '' }]),
    startSession: (_options, ids) =>
      Ref.update(calls.started, (all) => [...all, ids]).pipe(
        Effect.as(ids.resumeProviderSessionId ?? ProviderSessionId.make(`${provider}-native`)),
      ),
    send: (message) =>
 Stream.fromIterable<ChatEvent>([ { _tag: 'TurnStarted', sessionId: message.sessionId, turnId: TurnId.make('t1') }, { _tag: 'TurnFinished', sessionId: message.sessionId, turnId: TurnId.make('t1'), outcome: 'Completed', usage: { inputTokens: 1, outputTokens: 2 }, }, ]),
    resolvePermission: () => unused,
    answerQuestion: () => unused,
    interrupt: () => unused,
    closeSession: (id) => Ref.update(calls.closed, (ids) => [...ids, id]),
    append: () => unused,
    load: () => Effect.succeed([]),
    listSessions: () => Effect.succeed([]),
    listSessionMetadata: () => Effect.succeed([]),
    delete: () => unused,
    listSubagentSession: () => Effect.succeed([]),
  };
};

const makeHarness = Effect.gen(function* () {
  const calls: Calls = {
    startups: yield* Ref.make(0),
    closed: yield* Ref.make<ReadonlyArray<SessionId>>([]),
    shutdowns: yield* Ref.make(0),
    started: yield* Ref.make<ReadonlyArray<StartedSession>>([]),
  };
  const layerRegistry = Layer.succeed(SdkAdapterRegistry, {
    defaultProvider: 'Claude',
    get: (provider) => Effect.succeed(makeFakeAdapter(provider, calls)),
  });
  const layerServices = Layer.mergeAll(layerProjectResolver, layerSessionObserver).pipe(
    Layer.provideMerge(layerSessionRepo(':memory:')),
  );
  return { calls, layer: layerChatRpc.pipe(Layer.provideMerge(Layer.merge(layerRegistry, layerServices))) };
});

describe('ChatRpc', () => {
  it.effect('starts the adapter once however many calls follow', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        yield* chat.startup;
        yield* chat.startup;
        yield* chat.startSession(options('Claude'));
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(calls.startups)).toBe(1);
    }));

  it.effect('lists the models of the active adapter', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const models = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.models;
      }).pipe(Effect.provide(layer));
      expect(models).toEqual([{ id: 'Claude-model', efforts: ['Default'] }]);
    }));

  it.effect('lists the commands of the active adapter for a cwd, without an open session', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const commands = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.commands('/work');
      }).pipe(Effect.provide(layer));
      expect(commands).toEqual([{ name: 'Claude-cmd', description: '/work', argumentHint: '' }]);
    }));

  it.effect('streams the adapter turn for an open session', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const tags = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession(options('Claude'));
        const events = yield* Stream.runCollect(chat.send({ sessionId, text: 'hi', files: [] }));
        return events.map((event) => event._tag);
      }).pipe(Effect.provide(layer));
      expect(tags).toEqual(['TurnStarted', 'TurnFinished']);
    }));

  it.effect('rejects send on an unknown session', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const error = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* Stream.runCollect(
          chat.send({ sessionId: SessionId.make('nope'), text: 'hi', files: [] }),
        ).pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      expect(error).toBeInstanceOf(ChatError);
      expect(error.reason).toBe('SessionNotFound');
    }));

  it.effect('refuses a session for a provider that is not active', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const error = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.startSession(options('OpenAI')).pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      expect(error.reason).toBe('Unsupported');
    }));

  it.effect('changeAdapter closes open sessions, shuts the old adapter down and starts the new one', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      const outcome = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession(options('Claude'));
        const capabilities = yield* chat.changeAdapter('OpenAI');
        const error = yield* chat.interrupt(sessionId).pipe(Effect.flip);
        return { sessionId, capabilities, error };
      }).pipe(Effect.provide(layer));
      expect(outcome.capabilities.provider).toBe('OpenAI');
      expect(outcome.error.reason).toBe('SessionNotFound');
      expect(yield* Ref.get(calls.closed)).toEqual([outcome.sessionId]);
      expect(yield* Ref.get(calls.shutdowns)).toBe(1);
      expect(yield* Ref.get(calls.startups)).toBe(2);
    }));

  it.effect('stores a new session under our id, apart from the SDK id, in the project of its cwd', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const stored = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const repo = yield* SessionRepo;
        const sessionId = yield* chat.startSession(options('Claude'));
        return { sessionId, row: yield* repo.get(sessionId) };
      }).pipe(Effect.provide(layer));
      expect(Option.isSome(stored.row)).toBe(true);
      expect(stored.row.pipe(Option.map((row) => row.providerSessionId))).toEqual(
        Option.some('Claude-native'),
      );
      expect(stored.row.pipe(Option.map((row) => row.sessionId))).toEqual(Option.some(stored.sessionId));
      expect(stored.sessionId).not.toBe('Claude-native');
    }));

  it.effect('names the session after the first message only', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const title = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const repo = yield* SessionRepo;
        const sessionId = yield* chat.startSession(options('Claude'));
        yield* Stream.runCollect(chat.send({ sessionId, text: '  Fix the\n login bug ', files: [] }));
        yield* Stream.runCollect(chat.send({ sessionId, text: 'and the logout one', files: [] }));
        return (yield* repo.get(sessionId)).pipe(Option.map((row) => row.title));
      }).pipe(Effect.provide(layer));
      expect(title).toEqual(Option.some('Fix the'));
    }));

  it.effect('resumes a stored session under its own ids', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      const sessionId = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const first = yield* chat.startSession(options('Claude'));
        yield* chat.closeSession(first);
        const resumed = yield* chat.startSession({ ...options('Claude'), resume: first });
        expect(resumed).toBe(first);
        expect(yield* chat.isOpen(resumed)).toBe(true);
        return first;
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(calls.started)).toEqual([
        { sessionId },
        { sessionId, resumeProviderSessionId: 'Claude-native' },
      ]);
    }));

  it.effect('refuses to resume a session that was never stored', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const error = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.startSession({ ...options('Claude'), resume: SessionId.make('nope') }).pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      expect(error.reason).toBe('SessionNotFound');
    }));

  it.effect('changeAdapter to the active provider is a no-op', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        yield* chat.startSession(options('Claude'));
        yield* chat.changeAdapter('Claude');
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(calls.shutdowns)).toBe(0);
      expect(yield* Ref.get(calls.startups)).toBe(1);
    }));
});
