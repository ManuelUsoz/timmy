import { describe, expect, it } from '@effect/vitest';
import { randomUUID } from 'node:crypto';
import { Deferred, Effect, Fiber, Layer, Ref, Stream, type Scope } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import type { ChatEvent } from '../../src/shared/chat/event.model';
import { PermissionRequestId, SessionId } from '../../src/shared/chat/ids.model';
import type { PermissionRequest } from '../../src/shared/chat/permission.model';
import type { PermissionMode } from '../../src/shared/chat/provider.model';
import type { SessionOptions } from '../../src/shared/chat/session.model';
import { ProjectId, ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AttachmentStore, layerAttachmentStore } from '../attachments/attachment-store';
import { layerImageResizerTest } from '../attachments/image-resizer';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { makeOpenCodeAdapter } from './opencode-adapter';
import {
  OpenCodeBackend,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeImage,
  type OpenCodeModel,
  type OpenCodePermissionRule,
  type PermissionReply,
} from './opencode-backend';
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
  replyPermission: OpenCodeClient['replyPermission'] = () => Effect.void,
  createSession: OpenCodeClient['createSession'] = () => Effect.succeed('oc-session'),
): OpenCodeClient => ({
  models: Effect.succeed(models),
  createSession,
  turn,
  replyPermission,
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
const itRepo = <E>(name: string, body: () => Effect.Effect<void, E, SessionRepo | AttachmentStore | Scope.Scope>) =>
  it.effect(name, () =>
    body().pipe(
      Effect.provide(layerSessionRepo(':memory:')),
      Effect.provide(
        layerAttachmentStore(path.join(mkdtempSync(path.join(tmpdir(), 'timmy-opencode-')), 'attachments')).pipe(
          Layer.provide(layerImageResizerTest),
        ),
      ),
    ),
  );

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const projectId = ProjectId.make('p1');
const options: SessionOptions = { provider: 'OpenCode', cwd: '/work', permissionMode: 'Default' };

/** Starts the adapter and opens a session the way `ChatRpc` does: start it, then store its row. */
const readySession = (log: ServerLog, client: OpenCodeClient, sessionOptions: SessionOptions = options) =>
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, client)));
    yield* adapter.startup;
    const sessionId = SessionId.make(randomUUID());
    const providerSessionId = yield* adapter.startSession(sessionOptions, { sessionId });
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
      const models = [{ id: 'anthropic/claude-opus-5-5', variants: ['low', 'high', 'max', 'xhigh'], images: true }, { id: 'opencode/big-pickle', variants: [] }];
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient(models))));
      yield* adapter.startup;
      expect(yield* adapter.models).toEqual([
        { id: 'anthropic/claude-opus-5-5', efforts: ['Default', 'Low', 'High', 'XHigh'], images: true },
        { id: 'opencode/big-pickle', efforts: ['Default'], images: false },
      ]);
      expect(yield* Ref.get(log.started)).toBe(1);
      expect(yield* Ref.get(log.stopped)).toBe(0);
      yield* adapter.shutdown;
      expect(yield* Ref.get(log.stopped)).toBe(1);
    }));

  itRepo('opens the session with the variant that matches the chosen effort', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const seen = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
      const client = fakeClient([{ id: 'opencode/big-pickle', variants: ['high'] }], undefined, undefined, undefined, (o) =>
        Ref.modify(seen, (all) => [`oc-${all.length}`, [...all, o.variant]]),
      );
      yield* readySession(log, client, { ...options, model: 'opencode/big-pickle', effort: 'High' });
      yield* readySession(log, client, { ...options, model: 'opencode/big-pickle', effort: 'Default' });
      expect(yield* Ref.get(seen)).toEqual(['high', undefined]);
    }));

  itRepo('refuses an effort the model does not offer instead of opening the session', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const opened = yield* Ref.make(0);
      const client = fakeClient([{ id: 'opencode/big-pickle', variants: ['high'] }], undefined, undefined, undefined, () =>
        Ref.update(opened, (n) => n + 1).pipe(Effect.as('oc-session')),
      );
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, client)));
      yield* adapter.startup;
      const error = yield* adapter
        .startSession({ ...options, model: 'opencode/big-pickle', effort: 'XHigh' }, { sessionId: SessionId.make(randomUUID()) })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ reason: 'Unsupported', detail: 'opencode/big-pickle does not offer effort XHigh' });
      expect(yield* Ref.get(opened)).toBe(0);
    }));

  itRepo('has no models before it is started', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([{ id: 'a/b', variants: [] }]))));
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
        [{ id: 'opencode/big-pickle', variants: [] }],
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
        [{ id: 'opencode/big-pickle', variants: [] }],
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
        [{ id: 'opencode/big-pickle', variants: [] }],
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

  itRepo('claims tool calls and permissions, and every Permission mode it can honour', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([]))));
      expect(adapter.capabilities).toEqual({
        provider: 'OpenCode',
        subagents: false,
        toolCalls: true,
        permissions: true,
        // OpenCode 2 ships no plan agent, so Plan could only be faked: it is not offered.
        permissionModes: ['Auto', 'AutoAccept', 'Default'],
        questions: false,
        thinking: false,
        resume: false,
        images: true,
        mentions: 'none',
      });
    }));

  itRepo('AC 2: sends the image content of an Attachment to OpenCode with the prompt', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const seen = yield* Ref.make<ReadonlyArray<OpenCodeImage>>([]);
      const client = fakeClient([{ id: 'anthropic/claude-opus-5-5', variants: [], images: true }], (o) =>
        Stream.fromEffect(Ref.set(seen, o.images ?? [])).pipe(Stream.flatMap(() => Stream.make<OpenCodeEvent[]>({ _tag: 'Idle' }))),
      );
      const { adapter, sessionId } = yield* readySession(log, client);
      const stored = yield* (yield* AttachmentStore).add(PNG);
      yield* Stream.runDrain(adapter.send({ sessionId, text: 'what is this?', mentions: [], attachments: [{ id: stored.id }] }));
      expect(yield* Ref.get(seen)).toEqual([{ mediaType: 'image/png', bytes: PNG }]);
    }));

  itRepo('AC 3: a model without the image modality is declared as not taking images, so the composer blocks them', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const client = fakeClient([
        { id: 'anthropic/claude-opus-5-5', variants: [], images: true },
        { id: 'opencode/text-only', variants: [], images: false },
        { id: 'opencode/unknown', variants: [] },
      ]);
      const { adapter } = yield* readySession(log, client);
      expect(adapter.capabilities.images).toBe(true);
      const byId = new Map((yield* adapter.models).map((m) => [m.id, m.images]));
      expect([byId.get('anthropic/claude-opus-5-5'), byId.get('opencode/text-only'), byId.get('opencode/unknown')]).toEqual([true, false, false]);
    }));

  itRepo('keeps the partial answer when the consumer stops listening mid-turn', () =>
    Effect.gen(function* () {
      const log = yield* makeServerLog;
      const speaking = yield* Deferred.make<void>();
      const client = fakeClient([{ id: 'opencode/big-pickle', variants: [] }], () =>
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
      const { adapter, sessionId } = yield* readySession(log, fakeClient([{ id: 'opencode/big-pickle', variants: [] }]));

      yield* adapter.startup;

      const error = yield* say(adapter, sessionId, 'hi').pipe(Effect.flip);
      expect(error.reason).toBe('SessionNotFound');
    }));

  describe('tool calls', () => {
    itRepo('shows a tool call from its start through each update to its final status', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const client = fakeClient(
          [{ id: 'opencode/big-pickle', variants: [] }],
          script(
            { _tag: 'Tool', tool: { id: 't1', name: 'bash', input: {}, status: 'Pending' } },
            { _tag: 'Tool', tool: { id: 't1', name: 'bash', input: { command: 'ls' }, status: 'Running' } },
            { _tag: 'Tool', tool: { id: 't1', name: 'bash', input: { command: 'ls' }, status: 'Completed', output: 'a.txt' } },
            { _tag: 'Idle' },
          ),
        );
        const { adapter, sessionId } = yield* readySession(log, client);

        const events = yield* say(adapter, sessionId, 'list files');

        expect(tags(events)).toEqual(['TurnStarted', 'ToolCallStarted', 'ToolCallUpdated', 'ToolCallUpdated', 'TurnFinished']);
        const calls = events.flatMap((event) =>
          event._tag === 'ToolCallStarted' || event._tag === 'ToolCallUpdated' ? [event.call] : [],
        );
        expect(calls.map((call) => call.status)).toEqual(['Pending', 'Running', 'Completed']);
        expect(new Set(calls.map((call) => call.id)).size).toBe(1);
        expect(calls.at(-1)).toMatchObject({ name: 'Shell', kind: 'Execute', title: 'Shell ls', output: 'a.txt' });
      }));

    itRepo('shows a failed tool call as Failed with what OpenCode said', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const client = fakeClient(
          [{ id: 'opencode/big-pickle', variants: [] }],
          script(
            { _tag: 'Tool', tool: { id: 't1', name: 'read', input: { filePath: '/work/x.ts' }, status: 'Running' } },
            { _tag: 'Tool', tool: { id: 't1', name: 'read', input: { filePath: '/work/x.ts' }, status: 'Failed', output: 'no such file' } },
            { _tag: 'Idle' },
          ),
        );
        const { adapter, sessionId } = yield* readySession(log, client);

        const events = yield* say(adapter, sessionId, 'read it');

        const last = events.filter((event) => event._tag === 'ToolCallUpdated').at(-1);
        expect(last?._tag === 'ToolCallUpdated' ? last.call : undefined).toMatchObject({
          kind: 'Read',
          status: 'Failed',
          output: 'no such file',
          locations: [{ path: '/work/x.ts' }],
        });
      }));

    itRepo('names known tools like Claude does and keeps the native name of any other', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const client = fakeClient(
          [{ id: 'opencode/big-pickle', variants: [] }],
          script(
            { _tag: 'Tool', tool: { id: 't1', name: 'read', input: { filePath: '/work/x.ts' }, status: 'Running' } },
            { _tag: 'Tool', tool: { id: 't2', name: 'github_search', input: {}, status: 'Running' } },
            { _tag: 'Idle' },
          ),
        );
        const { adapter, sessionId } = yield* readySession(log, client);

        const events = yield* say(adapter, sessionId, 'go');

        const calls = events.flatMap((event) => (event._tag === 'ToolCallStarted' ? [event.call] : []));
        expect(calls).toMatchObject([
          { name: 'Read', kind: 'Read', title: 'Read /work/x.ts' },
          { name: 'github_search', kind: 'Other', title: 'github_search' },
        ]);
      }));

    itRepo('carries the diff of an edit', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const input = { filePath: '/work/a.ts', oldString: 'let a', newString: 'const a' };
        const client = fakeClient(
          [{ id: 'opencode/big-pickle', variants: [] }],
          script({ _tag: 'Tool', tool: { id: 't1', name: 'edit', input, status: 'Running' } }, { _tag: 'Idle' }),
        );
        const { adapter, sessionId } = yield* readySession(log, client);

        const events = yield* say(adapter, sessionId, 'fix');

        const started = events.find((event) => event._tag === 'ToolCallStarted');
        expect(started?._tag === 'ToolCallStarted' ? started.call : undefined).toMatchObject({
          kind: 'Edit',
          diffs: [{ path: '/work/a.ts', oldText: 'let a', newText: 'const a' }],
        });
      }));
  });

  describe('asks', () => {
    /** A turn that asks once, waits for the reply, and finishes; the fake server echoes the reply back as OpenCode does. */
    const askingClient = (replies: Ref.Ref<ReadonlyArray<string>>, reply: Deferred.Deferred<PermissionReply>) =>
      fakeClient(
        [{ id: 'opencode/big-pickle', variants: [] }],
        () =>
          Stream.make<OpenCodeEvent[]>(
            { _tag: 'Tool', tool: { id: 't1', name: 'bash', input: { command: 'rm x' }, status: 'Pending' } },
            { _tag: 'PermissionAsked', id: 'p1', action: 'bash', resources: ['rm x'], toolCallId: 't1' },
          ).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.await(reply)).pipe(
                Stream.flatMap((answer) =>
                  Stream.make<OpenCodeEvent[]>({ _tag: 'PermissionReplied', id: 'p1', reply: answer }, { _tag: 'Idle' }),
                ),
              ),
            ),
          ),
        undefined,
        ({ requestId, reply: answer }) =>
          Ref.update(replies, (all) => [...all, `${requestId}:${answer}`]).pipe(Effect.andThen(Deferred.succeed(reply, answer))),
      );

    /** Runs a turn against `askingClient`, answers the Ask with the option of `kind`, and returns what the turn said. */
    const answerAsk = (kind: 'AllowOnce' | 'RejectOnce') =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const replies = yield* Ref.make<ReadonlyArray<string>>([]);
        const reply = yield* Deferred.make<PermissionReply>();
        const { adapter, sessionId } = yield* readySession(log, askingClient(replies, reply));
        const asked = yield* Deferred.make<PermissionRequest>();

        const turn = yield* Effect.forkChild(
          adapter.send({ sessionId, text: 'go', mentions: [], attachments: [] }).pipe(
            Stream.tap((event) => (event._tag === 'PermissionRequested' ? Deferred.succeed(asked, event.request) : Effect.void)),
            Stream.runCollect,
            Effect.map((events) => [...events]),
          ),
        );
        const request = yield* Deferred.await(asked);
        const option = request.options.find((candidate) => candidate.kind === kind);
        if (option === undefined) return yield* Effect.die(`no ${kind} option`);
        yield* adapter.resolvePermission(sessionId, { _tag: 'Selected', requestId: request.id, optionId: option.id });
        return { request, events: yield* Fiber.join(turn), replies: yield* Ref.get(replies) };
      });

    itRepo('turns an OpenCode permission event into an Ask that can only be allowed once or denied', () =>
      Effect.gen(function* () {
        const { request } = yield* answerAsk('AllowOnce');

        expect(request).toMatchObject({
          id: 'p1',
          toolCall: { id: 't1', kind: 'Execute', name: 'Shell' },
          options: [{ kind: 'AllowOnce' }, { kind: 'RejectOnce' }],
        });
        expect(request.options.map((option) => option.kind)).toEqual(['AllowOnce', 'RejectOnce']);
      }));

    itRepo('allow answers OpenCode once, then reports the Ask as resolved', () =>
      Effect.gen(function* () {
        const { events, replies } = yield* answerAsk('AllowOnce');

        expect(replies).toEqual(['p1:once']);
        expect(tags(events)).toEqual([
          'TurnStarted',
          'ToolCallStarted',
          'PermissionRequested',
          'PermissionResolved',
          'TurnFinished',
        ]);
        expect(events.find((event) => event._tag === 'PermissionResolved')).toMatchObject({
          requestId: 'p1',
          response: { _tag: 'Selected' },
        });
      }));

    itRepo('deny answers OpenCode with a rejection, never always', () =>
      Effect.gen(function* () {
        const { replies } = yield* answerAsk('RejectOnce');

        expect(replies).toEqual(['p1:reject']);
      }));

    itRepo('refuses an answer to an Ask that is not waiting', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const { adapter, sessionId } = yield* readySession(log, fakeClient([{ id: 'opencode/big-pickle', variants: [] }]));
        const error = yield* adapter
          .resolvePermission(sessionId, { _tag: 'Cancelled', requestId: PermissionRequestId.make('nope') })
          .pipe(Effect.flip);
        expect(error.reason).toBe('RequestNotFound');
      }));

    itRepo('interrupting a turn that waits on an Ask cancels the Ask and ends the turn as Cancelled', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const gate = yield* Deferred.make<void>();
        const asked = yield* Deferred.make<void>();
        const client = fakeClient(
          [{ id: 'opencode/big-pickle', variants: [] }],
          () =>
            Stream.make<OpenCodeEvent[]>({ _tag: 'PermissionAsked', id: 'p1', action: 'bash', resources: ['rm x'] }).pipe(
              Stream.tap(() => Deferred.succeed(asked, undefined)),
              Stream.concat(
                Stream.fromEffect(Deferred.await(gate)).pipe(Stream.map((): OpenCodeEvent => ({ _tag: 'Idle' }))),
              ),
            ),
          () => Deferred.succeed(gate, undefined).pipe(Effect.asVoid),
        );
        const { adapter, sessionId } = yield* readySession(log, client);

        const turn = yield* Effect.forkChild(say(adapter, sessionId, 'go'));
        yield* Deferred.await(asked);
        yield* adapter.interrupt(sessionId);
        const events = yield* Fiber.join(turn);

        expect(tags(events)).toEqual(['TurnStarted', 'PermissionRequested', 'PermissionResolved', 'TurnFinished']);
        expect(events.find((event) => event._tag === 'PermissionResolved')).toMatchObject({
          requestId: 'p1',
          response: { _tag: 'Cancelled' },
        });
        const finished = events.at(-1);
        expect(finished?._tag === 'TurnFinished' ? finished.outcome : undefined).toBe('Cancelled');
      }));
  });

  describe('Permission modes', () => {
    /** The standing rules a session of `mode` is opened with. */
    const rulesFor = (mode: PermissionMode) =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const opened = yield* Ref.make<ReadonlyArray<OpenCodePermissionRule>>([]);
        const client = fakeClient([{ id: 'opencode/big-pickle', variants: [] }], undefined, undefined, undefined, ({ permissions }) =>
          Ref.set(opened, permissions).pipe(Effect.as('oc-session')),
        );
        yield* readySession(log, client, { ...options, permissionMode: mode });
        return yield* Ref.get(opened);
      });
    /** OpenCode lets a later rule override an earlier one. */
    const effectOf = (rules: ReadonlyArray<OpenCodePermissionRule>, action: string) =>
      rules.filter((rule) => rule.action === action || rule.action === '*').at(-1)?.effect;

    itRepo('Default asks for edits and shell commands', () =>
      Effect.gen(function* () {
        const rules = yield* rulesFor('Default');
        expect(effectOf(rules, 'edit')).toBe('ask');
        expect(effectOf(rules, 'shell')).toBe('ask');
      }));

    itRepo('AutoAccept allows edits and still asks for shell commands', () =>
      Effect.gen(function* () {
        const rules = yield* rulesFor('AutoAccept');
        expect(effectOf(rules, 'edit')).toBe('allow');
        expect(effectOf(rules, 'shell')).toBe('ask');
      }));

    itRepo('Auto allows everything', () =>
      Effect.gen(function* () {
        const rules = yield* rulesFor('Auto');
        expect(effectOf(rules, 'edit')).toBe('allow');
        expect(effectOf(rules, 'shell')).toBe('allow');
        expect(effectOf(rules, 'anything-else')).toBe('allow');
      }));

    itRepo('refuses Plan, which is not offered because OpenCode 2 has no plan agent to run it faithfully', () =>
      Effect.gen(function* () {
        const log = yield* makeServerLog;
        const adapter = yield* makeOpenCodeAdapter.pipe(Effect.provide(layerBackend(log, fakeClient([{ id: 'a/b', variants: [] }]))));
        yield* adapter.startup;
        expect(adapter.capabilities.permissionModes).not.toContain('Plan');
        const error = yield* adapter
          .startSession({ ...options, permissionMode: 'Plan' }, { sessionId: SessionId.make(randomUUID()) })
          .pipe(Effect.flip);
        expect(error.reason).toBe('Unsupported');
      }));
  });
});
