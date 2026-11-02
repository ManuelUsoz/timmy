import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import type { OpenCodeClient as ServerClient, OpenCodeEvent as ServerEvent } from '@opencode/client';
import { Deferred, Effect, Layer, Ref, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { OpenCodeBackend, type OpenCodeClient, type OpenCodeEvent, type OpenCodeImage, type OpenCodeToolStatus } from './opencode-backend';

const MINIMUM_MAJOR = 2;
const START_TIMEOUT = '30 seconds';
/** How long the event stream may take to say hello before the prompt is given up on. */
const CONNECT_TIMEOUT = '10 seconds';
const KILL_GRACE_MS = 2_000;

/** The model list does not depend on a project, so it is read from a directory that always exists. */
const MODEL_LIST_DIRECTORY = homedir();

const notInstalled = new ChatError({
  reason: 'ProviderNotInstalled',
  detail: 'OpenCode is not installed. Install OpenCode 2 and make sure `opencode` is on your PATH',
});

const unreachable = (detail: string) => new ChatError({ reason: 'AdapterNotReady', detail });

/**
 * The client package is ESM-only and the main bundle is CJS, so it loads through a dynamic `import()`.
 * A load failure is a packaging bug, not something a caller can act on.
 */
const loadClientPackage = Effect.tryPromise({
  try: () => import('@opencode/client'),
  catch: (cause) => cause,
}).pipe(Effect.orDie);

/** Reads `opencode --version`: a missing binary, a binary that will not answer, and a CLI older than 2 are told apart. */
const checkInstalled = Effect.tryPromise({
  try: () =>
    new Promise<string>((resolve, reject) => {
      execFile('opencode', ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
    }),
  catch: (cause) =>
    typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT'
      ? notInstalled
      : unreachable(`\`opencode --version\` failed: ${String(cause)}`),
}).pipe(
  Effect.flatMap((stdout) => {
    const major = Number(/(\d+)\.\d+\.\d+/.exec(stdout)?.[1] ?? Number.NaN);
    return major >= MINIMUM_MAJOR
      ? Effect.void
      : Effect.fail(
          new ChatError({
            reason: 'Unsupported',
            detail: `Timmy needs OpenCode ${MINIMUM_MAJOR} or newer, found: ${stdout.trim()}. Update OpenCode`,
          }),
        );
  }),
);

/** Windows leaves the server's children behind on a plain kill, so the whole tree goes. */
const killTree = (child: ChildProcess) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return resolve();
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        // A server that ignores SIGTERM must not block quitting the app.
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, KILL_GRACE_MS).unref();
      }),
  );

/** Starts `opencode serve` on a random localhost port. The password is ours; the server dies with the scope. */
const spawnServer = (password: string) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      spawn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], {
        // Both names: OpenCode 2 reads one, earlier versions the other. Either way it is ours, not inherited.
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_PASSWORD: password },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ),
    killTree,
  );

/**
 * Resolves with the server's URL once it says it is listening. After that the output is still read
 * and thrown away: a server whose pipe nobody drains eventually blocks on its own logging.
 */
const listeningUrl = (child: ChildProcess) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        let output = '';
        const onOutput = (chunk: Buffer) => {
          output += chunk.toString();
          const url = /server listening on\s+(https?:\/\/[^\s]+)/i.exec(output)?.[1];
          if (url === undefined) return;
          child.stdout?.off('data', onOutput);
          child.stderr?.off('data', onOutput);
          child.off('error', onError);
          child.off('exit', onExit);
          child.stdout?.resume();
          child.stderr?.resume();
          resolve(url);
        };
        const onError = (error: Error) => reject(error);
        const onExit = (code: number | null) => reject(new Error(`OpenCode exited with code ${code}\n${output.trim()}`));
        child.stdout?.on('data', onOutput);
        child.stderr?.on('data', onOutput);
        child.once('error', onError);
        child.once('exit', onExit);
      }),
    catch: (cause) => unreachable(`OpenCode did not start: ${String(cause)}`),
  }).pipe(
    Effect.timeout(START_TIMEOUT),
    Effect.catchTag('TimeoutError', () => Effect.fail(unreachable('OpenCode did not start in time'))),
  );

/** `vendor/model` into the pair OpenCode wants. */
const modelRef = (model: string) => {
  const slash = model.indexOf('/');
  return slash < 1 || slash === model.length - 1
    ? Effect.fail(new ChatError({ reason: 'Unsupported', detail: `"${model}" is not an OpenCode model; expected vendor/model` }))
    : Effect.succeed({ providerID: model.slice(0, slash), id: model.slice(slash + 1) });
};

/** The text of a tool's result; files and other content have no place in a one-line output. */
const textOf = (content: ReadonlyArray<{ readonly type: string; readonly text?: string }> | undefined): string | undefined => {
  const joined = (content ?? []).flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n');
  return joined === '' ? undefined : joined;
};

/**
 * What one OpenCode event means for a Turn of `sessionId`; events of other sessions mean nothing here.
 * `tools` remembers each tool's name and last input, which its later events do not repeat.
 */
const translate = (
  sessionId: string,
  tools: Map<string, { readonly name: string; readonly input: Readonly<Record<string, unknown>> }>,
  /** Child sessions of this Turn (started through the task tool) by id, with the session that started each. */
  children: Map<string, string>,
  event: ServerEvent,
): ReadonlyArray<OpenCodeEvent> => {
  const data: unknown = 'data' in event ? event.data : undefined;
  if (typeof data !== 'object' || data === null || !('sessionID' in data) || typeof data.sessionID !== 'string') return [];
  const source = data.sessionID;
  if (event.type === 'session.created') {
    const parent = event.data.parentID;
    if (parent === undefined || (parent !== sessionId && !children.has(parent))) return [];
    children.set(source, parent);
    return [
      {
        _tag: 'AgentStarted',
        id: source,
        ...(parent === sessionId ? {} : { parentId: parent }),
        name: event.data.agent ?? 'subagent',
        ...(event.data.title === undefined ? {} : { task: event.data.title }),
      },
    ];
  }
  const root = source === sessionId;
  if (!root && !children.has(source)) return [];
  const route = root ? {} : { agent: source };
  const tool = (
    id: string,
    status: OpenCodeToolStatus,
    input?: Readonly<Record<string, unknown>>,
    output?: string,
  ): OpenCodeEvent => {
    const known = tools.get(id);
    const name = known?.name ?? 'tool';
    const latest = input ?? known?.input ?? {};
    tools.set(id, { name, input: latest });
    return { _tag: 'Tool', ...route, tool: { id, name, input: latest, status, ...(output === undefined ? {} : { output }) } };
  };
  switch (event.type) {
    case 'session.text.delta':
      return [{ _tag: 'TextDelta', text: event.data.delta, ...route }];
    case 'session.reasoning.delta':
      return [{ _tag: 'ReasoningDelta', text: event.data.delta, ...route }];
    case 'session.step.ended': {
      const { tokens, cost } = event.data;
      return [
        {
          _tag: 'StepEnded',
          ...route,
          usage: {
            inputTokens: Math.round(tokens.input),
            outputTokens: Math.round(tokens.output),
            cacheReadTokens: Math.round(tokens.cache.read),
            cacheWriteTokens: Math.round(tokens.cache.write),
            reasoningTokens: Math.round(tokens.reasoning),
            costUsd: cost,
          },
        },
      ];
    }
    case 'session.tool.input.started':
      tools.set(event.data.id, { name: event.data.name, input: {} });
      return [tool(event.data.id, 'Pending')];
    case 'session.tool.called':
      return [tool(event.data.id, 'Running', event.data.input)];
    case 'session.tool.success':
      return [tool(event.data.id, 'Completed', undefined, textOf(event.data.content))];
    case 'session.tool.failed':
      return [tool(event.data.id, 'Failed', undefined, textOf(event.data.content) ?? event.data.error.message)];
    case 'permission.asked':
      return [
        {
          _tag: 'PermissionAsked',
          id: event.data.id,
          action: event.data.action,
          resources: event.data.resources,
          ...(event.data.source?.type === 'tool' ? { toolCallId: event.data.source.id } : {}),
        },
      ];
    case 'permission.replied':
      return [{ _tag: 'PermissionReplied', id: event.data.requestID, reply: event.data.reply === 'reject' ? 'reject' : 'once' }];
    case 'session.execution.succeeded':
      return root ? [{ _tag: 'Idle' }] : [{ _tag: 'AgentEnded', id: source, outcome: 'Completed' }];
    case 'session.execution.interrupted':
      return root ? [{ _tag: 'Idle' }] : [{ _tag: 'AgentEnded', id: source, outcome: 'Cancelled' }];
    case 'session.execution.failed':
      return root ? [{ _tag: 'Failed', detail: event.data.error.message }] : [{ _tag: 'AgentEnded', id: source, outcome: 'Failed' }];
    default:
      return [];
  }
};

/** Images travel as `data:` URIs in the prompt's files; absent when there are none. */
const filesOf = (images: ReadonlyArray<OpenCodeImage> | undefined) =>
  images === undefined || images.length === 0
    ? {}
    : {
        files: images.map((image, index) => ({
          uri: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`,
          name: `image-${index + 1}`,
        })),
      };

const none: ReadonlyArray<OpenCodeEvent> = [];

const makeClient = (server: ServerClient): OpenCodeClient => ({
  models: Effect.tryPromise({
    try: () => server.model.list({ location: { directory: MODEL_LIST_DIRECTORY } }),
    catch: (cause) => unreachable(`OpenCode could not list its models: ${String(cause)}`),
  }).pipe(
    Effect.map(({ data }) => data.filter((model) => model.enabled).map((model) => ({
      id: `${model.providerID}/${model.id}`,
      variants: model.variants.map((variant) => String(variant.id)),
      contextWindow: model.limit.context,
      images: model.capabilities.input.includes('image'),
    }))),
  ),
  createSession: ({ cwd, model, variant, permissions }) =>
    Effect.gen(function* () {
      const ref = model === undefined ? undefined : yield* modelRef(model);
      const session = yield* Effect.tryPromise({
        try: () => server.session.create({
            location: { directory: cwd },
            ...(ref === undefined ? {} : { model: variant === undefined ? ref : { ...ref, variant } }),
            permissions: [...permissions],
          }),
        catch: (cause) => unreachable(`OpenCode could not open a session: ${String(cause)}`),
      });
      return session.id;
    }),
  turn: ({ sessionId, text, images }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const abort = new AbortController();
        const connected = yield* Deferred.make<void>();
        const ended = yield* Ref.make(false);
        const children = new Map<string, string>();
        const toolNames = new Map<string, { readonly name: string; readonly input: Readonly<Record<string, unknown>> }>();
        // Subscribe before prompting: the stream is not replayed, so an early event would be lost.
        const events = Stream.fromAsyncIterable(server.event.subscribe({ signal: abort.signal }), (cause) => cause).pipe(
          Stream.mapEffect((event) =>
            event.type === 'server.connected'
              ? Deferred.succeed(connected, undefined).pipe(Effect.as(none))
              : Effect.succeed(translate(sessionId, toolNames, children, event)),
          ),
          Stream.flattenIterable,
        );
        const prompt = Deferred.await(connected).pipe(
          Effect.timeout(CONNECT_TIMEOUT),
          Effect.andThen(
            Effect.tryPromise({ try: () => server.session.prompt({ sessionID: sessionId, text, ...filesOf(images) }), catch: (cause) => cause }),
          ),
          Effect.as(none),
          Effect.catch((cause) =>
            Effect.succeed<ReadonlyArray<OpenCodeEvent>>([
              { _tag: 'Failed', detail: `OpenCode did not take the message: ${String(cause)}` },
            ]),
          ),
          Stream.fromEffect,
          Stream.flattenIterable,
        );
        // A Turn is over when OpenCode says so. A stream that ends or breaks without saying so is a lost
        // connection, never a finished answer.
        const lost = Stream.fromEffect(Ref.get(ended)).pipe(
          Stream.flatMap((over) =>
            over ? Stream.empty : Stream.make<OpenCodeEvent[]>({ _tag: 'Failed', detail: 'The connection to OpenCode was lost' }),
          ),
        );
        return Stream.merge(events, prompt).pipe(
          Stream.tap((event) => (event._tag === 'Idle' || event._tag === 'Failed' ? Ref.set(ended, true) : Effect.void)),
          Stream.takeUntil((event) => event._tag === 'Idle' || event._tag === 'Failed'),
          Stream.catchCause(() => Stream.empty),
          Stream.concat(lost),
          Stream.ensuring(Effect.sync(() => abort.abort())),
        );
      }),
    ),
  replyPermission: ({ sessionId, requestId, reply }) =>
    Effect.tryPromise({
      try: () => server.permission.reply({ sessionID: sessionId, requestID: requestId, decision: reply }),
      catch: (cause) => cause,
    }).pipe(Effect.orDie),
  interrupt: (sessionId) =>
    Effect.tryPromise({ try: () => server.session.interrupt({ sessionID: sessionId }), catch: (cause) => cause }).pipe(
      Effect.asVoid,
      Effect.orDie,
    ),
});

const launch = Effect.gen(function* () {
  yield* checkInstalled;
  const password = randomBytes(24).toString('base64url');
  const child = yield* spawnServer(password);
  const url = yield* listeningUrl(child);
  const { OpenCode } = yield* loadClientPackage;
  // UTF-8, not Latin-1: the password is ours, but a header built with `btoa` would break on any non-ASCII byte.
  const authorization = `Basic ${Buffer.from(`opencode:${password}`, 'utf8').toString('base64')}`;
  const server = OpenCode.make({ baseUrl: url, headers: { Authorization: authorization } });
  // A server that does not answer as OpenCode 2 would serve an HTML page; this is the proof it is the right one.
  yield* Effect.tryPromise({ try: () => server.server.info(), catch: (cause) => cause }).pipe(
    Effect.mapError((cause) => unreachable(`OpenCode did not answer as expected: ${String(cause)}`)),
  );
  return makeClient(server);
});

/** The OpenCode this machine has: the installed `opencode` binary, run as a local server for the Adapter's lifetime. */
export const layerOpenCodeBackend = Layer.succeed(OpenCodeBackend, OpenCodeBackend.of({ launch }));
