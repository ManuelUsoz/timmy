import { randomUUID } from 'node:crypto';
import { Effect, Exit, Option, Ref, Schema, Scope, Semaphore, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import type { ChatEvent } from '../../src/shared/chat/event.model';
import { MessageId, type SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { AdapterCapabilities, type ModelInfo } from '../../src/shared/chat/provider.model';
import type { SessionOptions, UserMessage } from '../../src/shared/chat/session.model';
import { type HistoryItem, ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { SessionRepo, type TranscriptEntry } from '../sessions/session-repo';
import { rootAgentId, zeroUsage } from './claude-event-mapper';
import { OpenCodeBackend, type OpenCodeClient } from './opencode-backend';
import type { SdkAdapter } from './sdk-adapter';
import { makeSessionOps } from './session-ops';

/**
 * Only what the Adapter does today. The UI shows what is declared here, so a flag set early would offer
 * something that silently does nothing (images dropped, a permission prompt nobody answers). Each later
 * ticket turns its own flag on: tool calls and permissions, subagents and thinking, images, resume.
 */
const openCodeCapabilities: AdapterCapabilities = {
  provider: 'OpenCode',
  subagents: false,
  toolCalls: false,
  permissions: false,
  questions: false,
  thinking: false,
  resume: false,
  mentions: 'none',
  images: false,
};

interface Started {
  readonly client: OpenCodeClient;
  readonly scope: Scope.Closeable;
}

interface SessionRuntime {
  readonly options: SessionOptions;
  readonly providerSessionId: ProviderSessionId;
  /** Set by `interrupt`, cleared when a Turn starts; a Turn that ends while it is set was cancelled. */
  readonly interrupted: Ref.Ref<boolean>;
}

const noUsableModel = new ChatError({
  reason: 'AuthMissing',
  detail: 'OpenCode has no model you can use. Run `opencode auth login` or enable a model in OpenCode',
});

/** What Timmy stores for one message of an OpenCode conversation. OpenCode's own storage is never read. */
const StoredMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
});
const decodeStored = Schema.decodeUnknownOption(StoredMessage);

const storedEntry = (role: 'user' | 'assistant', text: string): TranscriptEntry => {
  const timestamp = new Date().toISOString();
  return { kind: role, uuid: randomUUID(), timestamp, native: { role, text } };
};

const historyOf = (entries: ReadonlyArray<TranscriptEntry>): ReadonlyArray<HistoryItem> =>
  entries.flatMap((entry): ReadonlyArray<HistoryItem> => {
    const stored = decodeStored(entry.native);
    if (Option.isNone(stored)) return [];
    return [
      {
        _tag: 'Message',
        role: stored.value.role === 'user' ? 'User' : 'Assistant',
        text: stored.value.text,
        ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
      },
    ];
  });

export const makeOpenCodeAdapter = Effect.gen(function* () {
  const backend = yield* OpenCodeBackend;
  const repo = yield* SessionRepo;
  const sessionOps = yield* makeSessionOps('OpenCode');
  const started = yield* Ref.make<Started | undefined>(undefined);
  const sessions = yield* Ref.make<ReadonlyMap<SessionId, SessionRuntime>>(new Map());

  const stop = Ref.getAndSet(started, undefined).pipe(
    Effect.flatMap((current) => (current === undefined ? Effect.void : Scope.close(current.scope, Exit.void))),
  );

  const startLock = yield* Semaphore.make(1);

  const startup = Effect.gen(function* () {
    yield* stop;
    // The new server knows none of the old sessions, so the Adapter must not pretend it does.
    yield* Ref.set(sessions, new Map());
    const scope = yield* Scope.make();
    const client = yield* backend.launch.pipe(
      Scope.provide(scope),
      Effect.tapError(() => Scope.close(scope, Exit.void)),
    );
    const models = yield* client.models;
    if (models.length === 0) {
      yield* Scope.close(scope, Exit.void);
      return yield* noUsableModel;
    }
    yield* Ref.set(started, { client, scope });
  }).pipe(startLock.withPermits(1));

  const requireClient = Effect.gen(function* () {
    const current = yield* Ref.get(started);
    return (
      current?.client ??
      (yield* new ChatError({ reason: 'AdapterNotReady', detail: 'OpenCode adapter was not started' }))
    );
  });

  const requireRuntime = Effect.fn('OpenCodeAdapter.requireRuntime')(function* (sessionId: SessionId) {
    const runtime = (yield* Ref.get(sessions)).get(sessionId);
    return (
      runtime ?? (yield* new ChatError({ reason: 'SessionNotFound', detail: `No open session ${sessionId}` }))
    );
  });

  const startSession: SdkAdapter['startSession'] = Effect.fn('OpenCodeAdapter.startSession')(
    function* (options, ids) {
      const client = yield* requireClient;
      const providerSessionId = ProviderSessionId.make(
        yield* client.createSession({ cwd: options.cwd, ...(options.model === undefined ? {} : { model: options.model }) }),
      );
      const interrupted = yield* Ref.make(false);
      yield* Ref.update(sessions, (m) => new Map(m).set(ids.sessionId, { options, providerSessionId, interrupted }));
      return providerSessionId;
    },
  );

  const runTurn = Effect.fn('OpenCodeAdapter.runTurn')(function* (client: OpenCodeClient, message: UserMessage) {
    const runtime = yield* requireRuntime(message.sessionId);
    const stored = yield* repo.get(message.sessionId);
    if (Option.isNone(stored)) {
      return yield* new ChatError({ reason: 'SessionNotFound', detail: `Session ${message.sessionId} is not stored` });
    }
    const ref = { projectId: stored.value.projectId, sessionId: message.sessionId };
    const { sessionId } = message;
    const turnId = TurnId.make(randomUUID());
    const messageId = MessageId.make(randomUUID());
    const text = yield* Ref.make('');
    const failure = yield* Ref.make<string | undefined>(undefined);
    const finished = yield* Ref.make(false);

    yield* Ref.set(runtime.interrupted, false);
    yield* repo.append(ref, [storedEntry('user', message.text)]);

    const saveAnswer = Effect.gen(function* () {
      const answer = yield* Ref.get(text);
      if (answer !== '') yield* repo.append(ref, [storedEntry('assistant', answer)]);
    });

    /** A consumer that stops listening still leaves what the agent said so far in the transcript. */
    const savePartial = Ref.get(finished).pipe(Effect.flatMap((done) => (done ? Effect.void : saveAnswer)));

    const finish = Effect.gen(function* () {
      yield* Ref.set(finished, true);
      yield* saveAnswer;
      const cancelled = yield* Ref.get(runtime.interrupted);
      const detail = cancelled ? undefined : yield* Ref.get(failure);
      return {
        _tag: 'TurnFinished',
        sessionId,
        turnId,
        outcome: cancelled ? 'Cancelled' : detail === undefined ? 'Completed' : 'Failed',
        ...(detail === undefined ? {} : { detail }),
        usage: zeroUsage,
      } satisfies ChatEvent;
    });

    const body = client.turn({ sessionId: runtime.providerSessionId, cwd: runtime.options.cwd, text: message.text }).pipe(
      Stream.takeUntil((event) => event._tag !== 'TextDelta'),
      Stream.mapEffect(
        Effect.fnUntraced(function* (event): Effect.fn.Return<ReadonlyArray<ChatEvent>> {
          if (event._tag === 'Failed') {
            yield* Ref.set(failure, event.detail);
            return [];
          }
          if (event._tag === 'Idle') return [];
          yield* Ref.update(text, (all) => all + event.text);
          return [
            {
              _tag: 'MessageDelta',
              sessionId,
              agentId: rootAgentId,
              messageId,
              channel: 'Text',
              text: event.text,
            } satisfies ChatEvent,
          ];
        }),
      ),
      Stream.flattenIterable,
    );

    return Stream.make<ChatEvent[]>({ _tag: 'TurnStarted', sessionId, turnId }).pipe(
      Stream.concat(body),
      Stream.concat(Stream.fromEffect(finish)),
      Stream.ensuring(savePartial),
    );
  });

  const interrupt: SdkAdapter['interrupt'] = Effect.fn('OpenCodeAdapter.interrupt')(function* (sessionId) {
    const runtime = yield* requireRuntime(sessionId);
    const client = yield* requireClient;
    yield* Ref.set(runtime.interrupted, true);
    yield* client.interrupt(runtime.providerSessionId);
  });

  const adapter: SdkAdapter = {
    capabilities: openCodeCapabilities,
    startup,
    shutdown: stop,
    models: requireClient.pipe(
      Effect.flatMap((client) => client.models),
      Effect.map((models) => models.map(({ id }): ModelInfo => ({ id, efforts: ['Default'] }))),
    ),
    listCommands: () => Effect.succeed([]),
    startSession,
    send: (message) =>
      Stream.unwrap(requireClient.pipe(Effect.flatMap((client) => runTurn(client, message)))),
    resolvePermission: () => Effect.void,
    answerQuestion: () => Effect.void,
    interrupt,
    closeSession: () => Effect.void,
    ...sessionOps,
    load: (ref) => repo.load(ref).pipe(Effect.map(Option.match({ onNone: () => [], onSome: historyOf }))),
  };
  return adapter;
});
