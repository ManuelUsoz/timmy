import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKUserMessage,
  SessionStore,
} from '@anthropic-ai/claude-agent-sdk';
import { Cause, Deferred, Effect, Option, Ref, Stream, Queue } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { PermissionRequestId, QuestionRequestId, SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { PermissionResponse } from '../../src/shared/chat/permission.model';
import { AdapterCapabilities, Effort, ModelInfo } from '../../src/shared/chat/provider.model';
import { QuestionResponse } from '../../src/shared/chat/question.model';
import { PermissionMode, SessionOptions, UserMessage } from '../../src/shared/chat/session.model';
import { ToolCall } from '../../src/shared/chat/tool-call.model';
import { ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { SessionRepo } from '../sessions/session-repo';
import { claudeHistory } from './claude-history-mapper';
import { makeClaudeSessionStore } from './claude-session-store';
import { makeSessionOps } from './session-ops';
import {
  describeToolCall,
  initialMapperState,
  MapperState,
  mapSdkMessage,
  rootAgentId,
  zeroUsage,
} from './claude-event-mapper';
import {
  buildPermissionRequest,
  buildQuestionRequest,
  permissionResult,
  questionResult,
} from './claude-interaction';
import { SdkAdapter } from './sdk-adapter';

type SdkQuery = typeof import('@anthropic-ai/claude-agent-sdk').query;

export interface ClaudeAdapterOptions {
  /** Path to the Claude Code binary; required when the app is packaged (see electron-builder `asarUnpack`). */
  readonly pathToClaudeCodeExecutable?: string;
}

const claudeCapabilities: AdapterCapabilities = {
  provider: 'Claude',
  subagents: true,
  toolCalls: true,
  permissions: true,
  questions: true,
  thinking: true,
  resume: true,
};

/**
 * The SDK spawns the Claude Code CLI, which reads its own credentials from its config dir,
 * so the app never handles OAuth tokens. This only asks the CLI (`claude auth status` prints
 * JSON with `loggedIn`). ANTHROPIC_API_KEY in env also counts. If the CLI is missing or the
 * probe fails the answer is false.
 */
export const checkClaudeLogin = (executable = 'claude'): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if ((process.env['ANTHROPIC_API_KEY'] ?? '') !== '') return true;
    const status = yield* Effect.tryPromise({
      try: async (): Promise<unknown> => {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(executable, ['auth', 'status'], { timeout: 15_000, windowsHide: true }, (error, out) =>
            error ? reject(error) : resolve(out),
          );
        });
        return JSON.parse(stdout);
      },
      catch: (cause) => cause,
    });
    return typeof status === 'object' && status !== null && 'loggedIn' in status && status.loggedIn === true;
  }).pipe(Effect.orElseSucceed(() => false));

/**
 * The SDK is ESM-only and the main bundle is CJS, so it loads through a dynamic
 * `import()`. A load failure is a packaging bug, not something a caller can act on.
 */
const loadSdkQuery: Effect.Effect<SdkQuery> = Effect.tryPromise({
  try: () => import('@anthropic-ai/claude-agent-sdk'),
  catch: (cause) => cause,
}).pipe(
  Effect.map((sdk) => sdk.query),
  Effect.orDie,
);

const SDK_PERMISSION_MODES: Readonly<Record<PermissionMode, NonNullable<Options['permissionMode']>>> = {
  Default: 'default',
  AutoAccept: 'acceptEdits',
  Plan: 'plan',
  Auto: 'auto',
};

const SDK_EFFORTS: Readonly<Record<Exclude<Effort, 'Default'>, NonNullable<Options['effort']>>> = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
};

const CLAUDE_EFFORTS: ReadonlyArray<Effort> = ['Default', 'Low', 'Medium', 'High', 'XHigh'];
const CLAUDE_MODELS: ReadonlyArray<ModelInfo> = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map(
  (id): ModelInfo => ({ id, efforts: CLAUDE_EFFORTS }),
);

/** A streaming prompt that never yields, so a probe query initializes without starting a turn. */
const idlePrompt: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SDKUserMessage>>(() => undefined) }),
};

const show = (value: unknown): string => JSON.stringify(value);

/** The query options minus the callback and abort controller, which do not serialize. */
const loggableOptions = ({
  canUseTool: _canUseTool,
  abortController: _abortController,
  sessionStore: _sessionStore,
  ...rest
}: Options) => rest;

type PendingMap<Id extends string, A> = ReadonlyMap<Id, Deferred.Deferred<A>>;

interface SessionRuntime {
  readonly options: SessionOptions;
  /** The id the SDK knows this session by; ours is the key of `sessions`. */
  readonly providerSessionId: ProviderSessionId;
  /** The SDK knows this session already, so later turns resume it instead of creating it. */
  readonly started: Ref.Ref<boolean>;
  readonly mapper: Ref.Ref<MapperState>;
  /** Set while a turn runs; aborting it cancels the turn. */
  readonly abort: Ref.Ref<AbortController | undefined>;
  readonly interrupted: Ref.Ref<boolean>;
  readonly permissions: Ref.Ref<PendingMap<PermissionRequestId, PermissionResponse>>;
  readonly questions: Ref.Ref<PendingMap<QuestionRequestId, QuestionResponse>>;
}

const makeRuntime = (options: SessionOptions, providerSessionId: ProviderSessionId, started: boolean) =>
  Effect.gen(function* () {
    return {
      options,
      providerSessionId,
      started: yield* Ref.make(started),
      mapper: yield* Ref.make(initialMapperState),
      abort: yield* Ref.make<AbortController | undefined>(undefined),
      interrupted: yield* Ref.make(false),
      permissions: yield* Ref.make<PendingMap<PermissionRequestId, PermissionResponse>>(new Map()),
      questions: yield* Ref.make<PendingMap<QuestionRequestId, QuestionResponse>>(new Map()),
    } satisfies SessionRuntime;
  });

const notFound = (sessionId: SessionId) =>
  new ChatError({ reason: 'SessionNotFound', detail: `No open session ${sessionId}` });

export const makeClaudeAgentSdkAdapter = (adapterOptions: ClaudeAdapterOptions = {}) =>
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const sessionOps = yield* makeSessionOps('Claude');
    const sessionStore: SessionStore = yield* makeClaudeSessionStore;
    const sdkRef = yield* Ref.make<SdkQuery | undefined>(undefined);
    const sessions = yield* Ref.make<ReadonlyMap<SessionId, SessionRuntime>>(new Map());
    const executableOption: Pick<Options, 'pathToClaudeCodeExecutable'> =
      adapterOptions.pathToClaudeCodeExecutable === undefined
        ? {}
        : { pathToClaudeCodeExecutable: adapterOptions.pathToClaudeCodeExecutable };

    const requireRuntime = Effect.fn('ClaudeAdapter.requireRuntime')(function* (sessionId: SessionId) {
      const runtime = (yield* Ref.get(sessions)).get(sessionId);
      return runtime ?? (yield* notFound(sessionId));
    });

    const requireSdk = Effect.gen(function* () {
      const sdkQuery = yield* Ref.get(sdkRef);
      return sdkQuery ?? (yield* new ChatError({ reason: 'AdapterNotReady', detail: 'Claude adapter was not started' }));
    });

    /** Answers every request still waiting on the user, so no `canUseTool` call hangs after a cancel. */
    const cancelPending = (runtime: SessionRuntime) =>
      Effect.gen(function* () {
        const permissions = yield* Ref.getAndSet(runtime.permissions, new Map());
        const questions = yield* Ref.getAndSet(runtime.questions, new Map());
        yield* Effect.forEach(
          permissions,
          ([requestId, deferred]) => Deferred.succeed(deferred, { _tag: 'Cancelled', requestId }),
          { discard: true },
        );
        yield* Effect.forEach(
          questions,
          ([requestId, deferred]) => Deferred.succeed(deferred, { _tag: 'Dismissed', requestId }),
          { discard: true },
        );
      });

    const interrupt = Effect.fn('ClaudeAdapter.interrupt')(function* (sessionId: SessionId) {
      const runtime = yield* requireRuntime(sessionId);
      const abort = yield* Ref.get(runtime.abort);
      if (abort === undefined) return;
      yield* Ref.set(runtime.interrupted, true);
      yield* cancelPending(runtime);
      abort.abort();
    });

    /**
     * `canUseTool` is a Promise-returning SDK callback, so this is the one place
     * an effect is run outside the runtime edge: it parks on a `Deferred` that
     * `resolvePermission` / `answerQuestion` completes.
     */
    const makeCanUseTool = (
      sessionId: SessionId,
      runtime: SessionRuntime,
      queue: Queue.Enqueue<ChatEvent, ChatError | Cause.Done>,
    ): CanUseTool => {
      const ask = Effect.fn('ClaudeAdapter.canUseTool')(function* (
        toolName: string,
        input: Readonly<Record<string, unknown>>,
        toolUseId: string,
        suggestions: Parameters<typeof permissionResult>[2],
        canAlwaysAllow: boolean,
      ): Effect.fn.Return<PermissionResult> {
        yield* Effect.logInfo(`[claude] <- canUseTool ${show({ toolName, toolUseId, input })}`);
        const mapper = yield* Ref.get(runtime.mapper);
        const known = mapper.toolCalls.get(toolUseId);
        const agentId = known?.agentId ?? rootAgentId;

        if (toolName === 'AskUserQuestion') {
          const request = buildQuestionRequest(toolUseId, agentId, input);
          if (request === undefined) return { behavior: 'deny', message: 'The question had no usable options' };
          const deferred = yield* Deferred.make<QuestionResponse>();
          yield* Ref.update(runtime.questions, (m) => new Map(m).set(request.id, deferred));
          yield* Queue.offer(queue, { _tag: 'QuestionAsked', sessionId, request });
          const response = yield* Deferred.await(deferred);
          yield* Queue.offer(queue, { _tag: 'QuestionResolved', sessionId, requestId: request.id, response });
          const result = questionResult(request, input, response);
          yield* Effect.logInfo(`[claude] -> canUseTool result ${show(result)}`);
          return result;
        }

        const call: ToolCall = known ?? describeToolCall(toolUseId, agentId, toolName, input);
        const request = buildPermissionRequest(toolUseId, agentId, call, canAlwaysAllow);
        const deferred = yield* Deferred.make<PermissionResponse>();
        yield* Ref.update(runtime.permissions, (m) => new Map(m).set(request.id, deferred));
        yield* Queue.offer(queue, { _tag: 'PermissionRequested', sessionId, request });
        const response = yield* Deferred.await(deferred);
        yield* Queue.offer(queue, { _tag: 'PermissionResolved', sessionId, requestId: request.id, response });
        const result = permissionResult(response, input, suggestions);
        yield* Effect.logInfo(`[claude] -> canUseTool result ${show(result)}`);
        if (result.behavior === 'allow') {
          yield* Queue.offer(queue, {
            _tag: 'ToolCallUpdated',
            sessionId,
            call: { ...call, status: 'Running' },
          });
        }
        return result;
      });

      return (toolName, input, options) =>
        Effect.runPromise(
          ask(
            toolName,
            input,
            options.toolUseID,
            options.suggestions,
            options.suggestions !== undefined && options.suggestions.length > 0 && options.suppressAlwaysAllowRule !== true,
          ),
        );
    };

    const queryOptions = (
      runtime: SessionRuntime,
      started: boolean,
      abortController: AbortController,
      canUseTool: CanUseTool,
    ): Options => ({
      cwd: runtime.options.cwd,
      permissionMode: SDK_PERMISSION_MODES[runtime.options.permissionMode],
      ...(runtime.options.model === undefined ? {} : { model: runtime.options.model }),
      ...(runtime.options.effort === undefined || runtime.options.effort === 'Default'
        ? {}
        : { effort: SDK_EFFORTS[runtime.options.effort] }),
      ...(runtime.options.systemPrompt === undefined ? {} : { systemPrompt: runtime.options.systemPrompt }),
      ...executableOption,
      ...(started ? { resume: runtime.providerSessionId } : { sessionId: runtime.providerSessionId }),
      sessionStore,
      includePartialMessages: true,
      abortController,
      canUseTool,
    });

    const runTurn = (sdkQuery: SdkQuery, sessionId: SessionId, runtime: SessionRuntime, message: UserMessage) =>
      Stream.callback<ChatEvent, ChatError>(
        Effect.fnUntraced(function* (queue) {
          const abortController = new AbortController();
          const claimed = yield* Ref.modify(runtime.abort, (current) =>
            current === undefined ? ([true, abortController] as const) : ([false, current] as const),
          );
          if (!claimed) {
            return yield* new ChatError({ reason: 'Unsupported', detail: 'A turn is already running in this session' });
          }
          yield* Ref.set(runtime.interrupted, false);
          const turnId = TurnId.make(randomUUID());
          const started = yield* Ref.get(runtime.started);
          const prompt =
            message.files.length === 0
              ? message.text
              : `${message.text}\n\n${message.files.map((file) => `@${file}`).join(' ')}`;
          const options = queryOptions(runtime, started, abortController, makeCanUseTool(sessionId, runtime, queue));
          yield* Effect.logInfo(`[claude] -> query ${show({ prompt, options: loggableOptions(options) })}`);
          const claudeQuery = sdkQuery({ prompt, options });

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              abortController.abort();
              claudeQuery.close();
            }).pipe(Effect.andThen(Ref.set(runtime.abort, undefined)), Effect.andThen(cancelPending(runtime))),
          );

          const finished = yield* Ref.make(false);
          const emit = (event: ChatEvent) =>
            event._tag === 'TurnFinished' ? Ref.set(finished, true).pipe(Effect.andThen(Queue.offer(queue, event))) : Queue.offer(queue, event);
          const finishTurn = (outcome: 'Cancelled' | 'Failed', detail?: string) =>
            Effect.gen(function* () {
              if (yield* Ref.get(finished)) return;
              yield* emit({
                _tag: 'TurnFinished',
                sessionId,
                turnId,
                outcome,
                ...(detail === undefined ? {} : { detail }),
                usage: zeroUsage,
              });
            });

          const consume = Effect.gen(function* () {
            yield* emit({ _tag: 'TurnStarted', sessionId, turnId });
            while (true) {
              const next = yield* Effect.promise(() => claudeQuery.next());
              if (next.done === true) break;
              const sdkMessage = next.value;
              // Partial stream events arrive per token; they only show at Debug level.
              yield* (sdkMessage.type === 'stream_event' ? Effect.logDebug : Effect.logInfo)(
                `[claude] <- ${sdkMessage.type} ${show(sdkMessage)}`,
              );
              if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
                yield* Ref.set(runtime.started, true);
              }
              const interrupted = yield* Ref.get(runtime.interrupted);
              const [events, mapper] = mapSdkMessage(yield* Ref.get(runtime.mapper), sdkMessage, {
                sessionId,
                turnId,
                interrupted,
              });
              yield* Ref.set(runtime.mapper, mapper);
              yield* Effect.forEach(events, emit, { discard: true });
            }
            const interrupted = yield* Ref.get(runtime.interrupted);
            yield* finishTurn(interrupted ? 'Cancelled' : 'Failed', interrupted ? undefined : 'The Claude session ended without a result');
          }).pipe(
            Effect.catchCause((cause) =>
              Ref.get(runtime.interrupted).pipe(
                Effect.flatMap((interrupted) =>
                  finishTurn(interrupted ? 'Cancelled' : 'Failed', interrupted ? undefined : Cause.pretty(cause)),
                ),
              ),
            ),
            Effect.ensuring(Queue.end(queue)),
          );
          yield* Effect.forkScoped(consume);
        }),
      );

    const adapter: SdkAdapter = {
      capabilities: claudeCapabilities,
      startup: Effect.gen(function* () {
        if (!(yield* checkClaudeLogin())) {
          return yield* new ChatError({
            reason: 'AuthMissing',
            detail: 'Claude Code is not logged in. Install it and run `claude auth login`, or set ANTHROPIC_API_KEY',
          });
        }
        yield* Ref.set(sdkRef, yield* loadSdkQuery);
      }),
      models: Effect.succeed(CLAUDE_MODELS),
      listCommands: Effect.fn('ClaudeAdapter.listCommands')(function* ({ cwd }) {
        const sdkQuery = yield* requireSdk;
        // Commands live on a Query, which a session only has while a turn runs. This probe never
        // sends a prompt: it initializes the CLI with the user's and project's settings, reads
        // the list and closes. Turn queries keep their own options.
        const probe = yield* Effect.acquireRelease(
          Effect.sync(() =>
            sdkQuery({
              prompt: idlePrompt,
              options: {
                cwd,
                settingSources: ['user', 'project', 'local'],
                ...executableOption,
              },
            }),
          ),
          (query) => Effect.sync(() => query.close()),
        );
        // A CLI that never answers is a defect, not something the caller can act on.
        const commands = yield* Effect.tryPromise({ try: () => probe.supportedCommands(), catch: (cause) => cause }).pipe(
          Effect.timeout('15 seconds'),
          Effect.orDie,
        );
        return commands.map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));
      }, Effect.scoped),
      shutdown: Effect.gen(function* () {
        const all = yield* Ref.getAndSet(sessions, new Map());
        yield* Effect.forEach(
          all.values(),
          (runtime) =>
            Ref.get(runtime.abort).pipe(
              Effect.tap(() => cancelPending(runtime)),
              Effect.tap((abort) => Effect.sync(() => abort?.abort())),
            ),
          { discard: true },
        );
        yield* Ref.set(sdkRef, undefined);
      }),
      startSession: Effect.fn('ClaudeAdapter.startSession')(function* (options, ids) {
        const providerSessionId = ids.resumeProviderSessionId ?? ProviderSessionId.make(randomUUID());
        // The SDK can only resume what the mirror stored; a session that never got a turn starts fresh.
        const stored = yield* repo.get(ids.sessionId);
        const hasTranscript =
          ids.resumeProviderSessionId !== undefined && Option.isSome(stored)
            ? Option.isSome(yield* repo.load({ projectId: stored.value.projectId, sessionId: ids.sessionId }))
            : false;
        const runtime = yield* makeRuntime(options, providerSessionId, hasTranscript);
        yield* Ref.update(sessions, (m) => new Map(m).set(ids.sessionId, runtime));
        return providerSessionId;
      }),
      send: (message) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const runtime = yield* requireRuntime(message.sessionId);
            const sdkQuery = yield* requireSdk;
            return runTurn(sdkQuery,message.sessionId, runtime, message);
          }),
        ),
      resolvePermission: Effect.fn('ClaudeAdapter.resolvePermission')(function* (sessionId, response) {
        const runtime = yield* requireRuntime(sessionId);
        const pending = (yield* Ref.get(runtime.permissions)).get(response.requestId);
        if (pending === undefined) {
          return yield* new ChatError({ reason: 'RequestNotFound', detail: `No pending permission ${response.requestId}` });
        }
        yield* Ref.update(runtime.permissions, (m) => {
          const next = new Map(m);
          next.delete(response.requestId);
          return next;
        });
        yield* Deferred.succeed(pending, response);
      }),
      answerQuestion: Effect.fn('ClaudeAdapter.answerQuestion')(function* (sessionId, response) {
        const runtime = yield* requireRuntime(sessionId);
        const pending = (yield* Ref.get(runtime.questions)).get(response.requestId);
        if (pending === undefined) {
          return yield* new ChatError({ reason: 'RequestNotFound', detail: `No pending question ${response.requestId}` });
        }
        yield* Ref.update(runtime.questions, (m) => {
          const next = new Map(m);
          next.delete(response.requestId);
          return next;
        });
        yield* Deferred.succeed(pending, response);
      }),
      interrupt,
      closeSession: Effect.fn('ClaudeAdapter.closeSession')(function* (sessionId) {
        yield* interrupt(sessionId);
        yield* Ref.update(sessions, (m) => {
          const next = new Map(m);
          next.delete(sessionId);
          return next;
        });
      }),
      ...sessionOps,
      load: (ref) =>
        repo.load(ref).pipe(
          Effect.map(Option.match({ onNone: () => [], onSome: claudeHistory })),
        ),
    };
    return adapter;
  });
