import { randomUUID } from 'node:crypto';
import { Effect, Exit, Option, Ref, Schema, Scope, Semaphore, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import type { ChatEvent } from '../../src/shared/chat/event.model';
import { MessageId, PermissionRequestId, type SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { AdapterCapabilities, type ModelInfo } from '../../src/shared/chat/provider.model';
import type { SessionOptions, UserMessage } from '../../src/shared/chat/session.model';
import { type HistoryItem, ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { AttachmentStore } from '../attachments/attachment-store';
import { SessionRepo,type TranscriptEntry } from '../sessions/session-repo';
import { rootAgentId, zeroUsage } from './claude-event-mapper';
import { OpenCodeBackend, type OpenCodeClient } from './opencode-backend';
import { buildAsk, describeTool, effortsOf, optionFor, replyFor, rulesFor, variantFor } from './opencode-mapper';
import type { ToolCall } from '../../src/shared/chat/tool-call.model';
import type { SdkAdapter } from './sdk-adapter';
import { makeSessionOps } from './session-ops';

/**
 * Only what the Adapter does today. The UI shows what is declared here, so a flag set early would offer
 * something that silently does nothing (images dropped, a question nobody answers). Each later ticket turns
 * its own flag on: subagents and thinking, images, resume.
 *
 * Plan is not a Permission mode here: OpenCode 2 ships no plan agent, so Plan could only be imitated.
 */
const openCodeCapabilities: AdapterCapabilities = {
  provider: 'OpenCode',
  subagents: false,
  toolCalls: true,
  permissions: true,
  permissionModes: ['Auto', 'AutoAccept', 'Default'],
  questions: false,
  thinking: false,
  resume: false,
  mentions: 'none',
  // Images are declared per model (see `models`): a model without the `image` input modality blocks them in the composer.
  images: true,
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
  /** Asks the user has not answered yet; an interrupt cancels them. */
  readonly waiting: Ref.Ref<ReadonlySet<PermissionRequestId>>;
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
  const attachments = yield* AttachmentStore;
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
      const mode = options.permissionMode;
      const variant = variantFor(options.effort);
      if (mode === 'Plan') {
        return yield* new ChatError({ reason: 'Unsupported', detail: 'OpenCode has no plan agent, so Plan mode is not available' });
      }
      if (variant !== undefined) {
        const offered = effortsOf((yield* client.models).find((m) => m.id === options.model)?.variants ?? []);
        if (!offered.includes(options.effort ?? 'Default')) {
          return yield* new ChatError({
            reason: 'Unsupported',
            detail: `${options.model ?? 'OpenCode'} does not offer effort ${options.effort}`,
          });
        }
      }
      const providerSessionId = ProviderSessionId.make(
        yield* client.createSession({
          cwd: options.cwd,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(variant === undefined ? {} : { variant }),
          permissions: rulesFor(mode),
        }),
      );
      const interrupted = yield* Ref.make(false);
      const waiting = yield* Ref.make<ReadonlySet<PermissionRequestId>>(new Set());
      yield* Ref.update(sessions, (m) => new Map(m).set(ids.sessionId, { options, providerSessionId, interrupted, waiting }));
      return providerSessionId;
    },
  );

  /** The stored bytes of the message's Attachments, in order; a file that is gone fails the send. */
  const readImages = (message: UserMessage) =>
    Effect.forEach(message.attachments, (attachment) =>
      attachments.read(attachment.id).pipe(
        Effect.mapError((error) => new ChatError({ reason: 'AttachmentNotFound', detail: error.detail })),
      ),
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
    const tools = yield* Ref.make<ReadonlyMap<string, ToolCall>>(new Map());

    yield* Ref.set(runtime.interrupted, false);
    yield* Ref.set(runtime.waiting, new Set());
    yield* repo.append(ref, [storedEntry('user', message.text)]);

    const saveAnswer = Effect.gen(function* () {
      const answer = yield* Ref.get(text);
      if (answer !== '') yield* repo.append(ref, [storedEntry('assistant', answer)]);
    });

    /** A consumer that stops listening still leaves what the agent said so far in the transcript. */
    const savePartial = Ref.get(finished).pipe(Effect.flatMap((done) => (done ? Effect.void : saveAnswer)));

    const finish = Effect.gen(function* (): Effect.fn.Return<ReadonlyArray<ChatEvent>> {
      yield* Ref.set(finished, true);
      yield* saveAnswer;
      const cancelled = yield* Ref.get(runtime.interrupted);
      const detail = cancelled ? undefined : yield* Ref.get(failure);
      // An Ask nobody answered cannot stay open once its Turn is over.
      const unanswered = yield* Ref.getAndSet(runtime.waiting, new Set());
      const closed = [...unanswered].map(
        (requestId): ChatEvent => ({ _tag: 'PermissionResolved', sessionId, requestId, response: { _tag: 'Cancelled', requestId } }),
      );
      return [
        ...closed,
        {
          _tag: 'TurnFinished',
          sessionId,
          turnId,
          outcome: cancelled ? 'Cancelled' : detail === undefined ? 'Completed' : 'Failed',
          ...(detail === undefined ? {} : { detail }),
          usage: zeroUsage,
        } satisfies ChatEvent,
      ];
    });

    const images = yield* readImages(message);
    const body = client.turn({ sessionId: runtime.providerSessionId, cwd: runtime.options.cwd, text: message.text, images }).pipe(
      Stream.takeUntil((event) => event._tag === 'Idle' || event._tag === 'Failed'),
      Stream.mapEffect(
        Effect.fnUntraced(function* (event): Effect.fn.Return<ReadonlyArray<ChatEvent>> {
          if (event._tag === 'Failed') {
            yield* Ref.set(failure, event.detail);
            return [];
          }
          if (event._tag === 'Idle') return [];
          if (event._tag === 'Tool') {
            const call = describeTool(rootAgentId, event.tool);
            const known = (yield* Ref.get(tools)).has(event.tool.id);
            yield* Ref.update(tools, (all) => new Map(all).set(event.tool.id, call));
            return [{ _tag: known ? 'ToolCallUpdated' : 'ToolCallStarted', sessionId, call } satisfies ChatEvent];
          }
          if (event._tag === 'PermissionAsked') {
            const known = event.toolCallId === undefined ? undefined : (yield* Ref.get(tools)).get(event.toolCallId);
            const request = buildAsk(event, rootAgentId, known);
            yield* Ref.update(runtime.waiting, (all) => new Set(all).add(request.id));
            return [{ _tag: 'PermissionRequested', sessionId, request } satisfies ChatEvent];
          }
          if (event._tag === 'PermissionReplied') {
            const requestId = PermissionRequestId.make(event.id);
            yield* Ref.update(runtime.waiting, (all) => new Set([...all].filter((id) => id !== requestId)));
            const response = { _tag: 'Selected', requestId, optionId: optionFor(event.reply) } as const;
            return [{ _tag: 'PermissionResolved', sessionId, requestId, response } satisfies ChatEvent];
          }
          if (event._tag !== 'TextDelta') return [];
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
      Stream.concat(Stream.fromEffect(finish).pipe(Stream.flattenIterable)),
      Stream.ensuring(savePartial),
    );
  });

  const interrupt: SdkAdapter['interrupt'] = Effect.fn('OpenCodeAdapter.interrupt')(function* (sessionId) {
    const runtime = yield* requireRuntime(sessionId);
    const client = yield* requireClient;
    yield* Ref.set(runtime.interrupted, true);
    // OpenCode must not be left holding an Ask the UI already shows as cancelled.
    yield* Effect.forEach(
      yield* Ref.get(runtime.waiting),
      (requestId) => client.replyPermission({ sessionId: runtime.providerSessionId, requestId, reply: 'reject' }),
      { discard: true },
    );
    yield* client.interrupt(runtime.providerSessionId);
  });

  const resolvePermission: SdkAdapter['resolvePermission'] = Effect.fn('OpenCodeAdapter.resolvePermission')(
    function* (sessionId, response) {
      const runtime = yield* requireRuntime(sessionId);
      const client = yield* requireClient;
      const { requestId } = response;
      if (!(yield* Ref.get(runtime.waiting)).has(requestId)) {
        return yield* new ChatError({ reason: 'RequestNotFound', detail: `No pending permission ${requestId}` });
      }
      // Only an explicit allow lets the tool run; cancelling the Ask rejects it.
      const reply = response._tag === 'Selected' ? replyFor(response.optionId) : 'reject';
      yield* client.replyPermission({ sessionId: runtime.providerSessionId, requestId, reply });
      yield* Ref.update(runtime.waiting, (all) => new Set([...all].filter((id) => id !== requestId)));
    },
  );

  const adapter: SdkAdapter = {
    capabilities: openCodeCapabilities,
    startup,
    shutdown: stop,
    models: requireClient.pipe(
      Effect.flatMap((client) => client.models),
      Effect.map((models) =>
        models.map(({ id, variants, images }): ModelInfo => ({ id, efforts: effortsOf(variants), images: images === true })),
      ),
    ),
    listCommands: () => Effect.succeed([]),
    startSession,
    send: (message) =>
      Stream.unwrap(requireClient.pipe(Effect.flatMap((client) => runTurn(client, message)))),
    resolvePermission,
    answerQuestion: () => Effect.void,
    interrupt,
    closeSession: () => Effect.void,
    ...sessionOps,
    load: (ref) => repo.load(ref).pipe(Effect.map(Option.match({ onNone: () => [], onSome: historyOf }))),
  };
  return adapter;
});
