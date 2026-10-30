import { randomUUID } from 'node:crypto';
import { Deferred, Effect, Layer, Option, Queue, Ref, Schema, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { AgentId, MessageId, OptionId, PermissionRequestId, SessionId, ToolCallId, TurnId } from '../../src/shared/chat/ids.model';
import { PermissionResponse } from '../../src/shared/chat/permission.model';
import { AdapterCapabilities } from '../../src/shared/chat/provider.model';
import { HistoryItem, ProviderSessionId, SessionSummary } from '../../src/shared/sessions/sessions.model';
import { projectIdOfCwd } from '../sessions/project-id';
import { SessionRepo } from '../sessions/session-repo';
import { SdkAdapter, SdkAdapterRegistry } from './sdk-adapter';

/**
 * Scripted stand-in for the Claude adapter, used by the end-to-end harness (`npm run e2e`).
 * It never touches the network. What a turn does is chosen by keywords in the user's message:
 *
 * - `edit` / `fix`: reads a file, then asks permission to edit it (Allow applies, Deny declines).
 * - `slow` / `long`: a turn that keeps "working" until Stop is pressed.
 * - `think`: streams a thinking block before the answer.
 * - `agent`: spawns a subagent that runs a search.
 * - `error` / `fail`: the turn fails.
 * - anything else: a short markdown answer.
 */

const AGENT = AgentId.make('root');
const MODEL = 'mock-sonnet';
const STEP_MS = 60;

const capabilities: AdapterCapabilities = {
  provider: 'Claude',
  subagents: true,
  toolCalls: true,
  permissions: true,
  questions: false,
  thinking: true,
  resume: true,
};

const ANSWER = [
  'Here is what I found.\n\n',
  '- The **shell** owns the three window modes\n',
  '- `ChatController` talks to main over the RPC port\n\n',
  '```ts\nconst mode = windowMode.mode();\n```\n',
].join('');

const EDIT_OLD = "export const startupMode: WindowMode = 'Pill';\n";
const EDIT_NEW = "export const startupMode: WindowMode = 'Panel';\n";

/** Past conversations shown in the session strip. Newest first. */
export const seededSessions: ReadonlyArray<{ readonly title: string; readonly items: ReadonlyArray<HistoryItem> }> = [
  {
    title: 'Explain the window modes',
    items: [
      { _tag: 'Message', role: 'User', text: 'Explain the window modes' },
      { _tag: 'Message', role: 'Assistant', text: 'Timmy has **three modes**: Pill, Panel and Expanded.' },
    ],
  },
  {
    title: 'Add a dark theme toggle',
    items: [
      { _tag: 'Message', role: 'User', text: 'Add a dark theme toggle' },
      { _tag: 'ToolCall', toolName: 'Edit', input: '{"file_path":"src/styles.css"}' },
      { _tag: 'Message', role: 'Assistant', text: 'Done. The toggle lives in the panel header.' },
    ],
  },
  {
    title: 'Why is the pill clipped?',
    items: [
      { _tag: 'Message', role: 'User', text: 'Why is the pill clipped?' },
      { _tag: 'Message', role: 'Assistant', text: 'The menu was rendered inside the 40px window.' },
    ],
  },
];

const decodeHistory = Schema.decodeUnknownSync(HistoryItem);

export const makeMockSdkAdapter = Effect.gen(function* () {
  const repo = yield* SessionRepo;
  const interrupts = yield* Ref.make<ReadonlyMap<SessionId, Deferred.Deferred<void>>>(new Map());
  const permissions = yield* Ref.make<ReadonlyMap<PermissionRequestId, Deferred.Deferred<PermissionResponse>>>(new Map());

  const adapter: SdkAdapter = {
    capabilities,
    startup: Effect.void,
    shutdown: Effect.void,
    models: Effect.succeed([
      { id: MODEL, efforts: ['Default', 'Low', 'Medium', 'High'] },
      { id: 'mock-opus', efforts: ['Default', 'High', 'XHigh'] },
    ]),
    listCommands: () =>
      Effect.succeed([
        { name: 'compact', description: 'Summarize the conversation', argumentHint: '' },
        { name: 'review', description: 'Review the current changes', argumentHint: '<branch>' },
        { name: 'init', description: 'Create a CLAUDE.md', argumentHint: '' },
      ]),
    startSession: (_options, ids) =>
      Effect.gen(function* () {
        const interrupted = yield* Deferred.make<void>();
        yield* Ref.update(interrupts, (map) => new Map(map).set(ids.sessionId, interrupted));
        return ids.resumeProviderSessionId ?? ProviderSessionId.make(`mock-${randomUUID()}`);
      }),
    send: (message) =>
      Stream.callback<ChatEvent, ChatError>(
        Effect.fnUntraced(function* (queue) {
          const sessionId = message.sessionId;
          const turnId = TurnId.make(randomUUID());
          const text = message.text.toLowerCase();
          const emit = (event: ChatEvent) => Queue.offer(queue, event);
          const pause = Effect.sleep(`${STEP_MS} millis`);
          const interrupted = (yield* Ref.get(interrupts)).get(sessionId);
          const messageId = MessageId.make(randomUUID());

          const say = Effect.fnUntraced(function* (body: string, channel: 'Text' | 'Thinking' = 'Text') {
            for (const chunk of body.match(/[\s\S]{1,24}/g) ?? []) {
              yield* emit({ _tag: 'MessageDelta', sessionId, agentId: AGENT, messageId, channel, text: chunk });
              yield* pause;
            }
          });

          const script = Effect.gen(function* () {
            if (text.includes('think')) yield* say('Weighing the options before answering.', 'Thinking');

            if (text.includes('agent')) {
              const child = AgentId.make('searcher');
              yield* emit({ _tag: 'AgentSpawned', sessionId, agent: { id: child, parentId: AGENT, name: 'Explore', task: 'Find window mode code' } });
              const call = {
                id: ToolCallId.make('grep-1'), agentId: child, name: 'Grep', kind: 'Search' as const,
                title: 'Grep WindowMode', status: 'Running' as const, locations: [], diffs: [],
              };
              yield* emit({ _tag: 'ToolCallStarted', sessionId, call });
              yield* pause;
              yield* emit({ _tag: 'ToolCallUpdated', sessionId, call: { ...call, status: 'Completed', output: '3 matches' } });
              yield* emit({ _tag: 'AgentFinished', sessionId, agentId: child, outcome: 'Completed' });
            }

            if (text.includes('slow') || text.includes('long')) {
              yield* say('Working through a long task…');
              return yield* Effect.never;
            }

            if (text.includes('error') || text.includes('fail')) {
              return 'Failed' as const;
            }

            if (text.includes('edit') || text.includes('fix')) {
              const read = {
                id: ToolCallId.make('read-1'), agentId: AGENT, name: 'Read', kind: 'Read' as const,
                title: 'Read src/shared/window/window.model.ts', status: 'Running' as const,
                locations: [{ path: 'src/shared/window/window.model.ts' }], diffs: [],
              };
              yield* emit({ _tag: 'ToolCallStarted', sessionId, call: read });
              yield* pause;
              yield* emit({ _tag: 'ToolCallUpdated', sessionId, call: { ...read, status: 'Completed' } });
              const edit = {
                id: ToolCallId.make('edit-1'), agentId: AGENT, name: 'Edit', kind: 'Edit' as const,
                title: 'src/shared/window/window.model.ts', status: 'Pending' as const,
                locations: [{ path: 'src/shared/window/window.model.ts' }],
                diffs: [{ path: 'src/shared/window/window.model.ts', oldText: EDIT_OLD, newText: EDIT_NEW }],
              };
              yield* emit({ _tag: 'ToolCallStarted', sessionId, call: edit });
              const requestId = PermissionRequestId.make(randomUUID());
              const answer = yield* Deferred.make<PermissionResponse>();
              yield* Ref.update(permissions, (map) => new Map(map).set(requestId, answer));
              yield* emit({
                _tag: 'PermissionRequested', sessionId,
                request: {
                  id: requestId, agentId: AGENT, toolCall: edit,
                  options: [
                    { id: OptionId.make('allow'), label: 'Allow', kind: 'AllowOnce' },
                    { id: OptionId.make('deny'), label: 'Deny', kind: 'RejectOnce' },
                  ],
                },
              });
              const response = yield* Deferred.await(answer);
              yield* emit({ _tag: 'PermissionResolved', sessionId, requestId, response });
              const allowed = response._tag === 'Selected' && response.optionId === 'allow';
              yield* emit({ _tag: 'ToolCallUpdated', sessionId, call: { ...edit, status: allowed ? 'Completed' : 'Failed' } });
              yield* say(allowed ? 'Done, the app now starts as a Panel.' : 'Understood, I left the file unchanged.');
              return 'Completed' as const;
            }

            yield* say(ANSWER);
            return 'Completed' as const;
          });

          const usage = { inputTokens: 1200, outputTokens: 340 };
          const finish = (outcome: 'Completed' | 'Cancelled' | 'Failed') =>
            emit({
              _tag: 'TurnFinished', sessionId, turnId, outcome, usage,
              ...(outcome === 'Failed' ? { detail: 'Mock failure: the provider returned an error.' } : {}),
            }).pipe(
              Effect.andThen(emit({ _tag: 'UsageUpdated', sessionId, usage, context: { usedTokens: 54_000, maxTokens: 200_000 } })),
            );

          yield* emit({ _tag: 'TurnStarted', sessionId, turnId });
          const body = interrupted === undefined ? script : Effect.race(script, Deferred.await(interrupted).pipe(Effect.as('Cancelled' as const)));
          const outcome = yield* body.pipe(Effect.map((o) => o ?? 'Completed'));
          yield* finish(outcome);
          yield* Queue.end(queue);
        }),
      ),
    resolvePermission: (_sessionId, response) =>
      Ref.get(permissions).pipe(
        Effect.flatMap((map) => {
          const pending = map.get(response.requestId);
          return pending === undefined ? Effect.void : Deferred.succeed(pending, response).pipe(Effect.asVoid);
        }),
      ),
    answerQuestion: () => Effect.void,
    interrupt: (sessionId) =>
      Effect.gen(function* () {
        const current = (yield* Ref.get(interrupts)).get(sessionId);
        if (current !== undefined) {
          yield* Deferred.succeed(current, undefined);
          const fresh = yield* Deferred.make<void>();
          yield* Ref.update(interrupts, (map) => new Map(map).set(sessionId, fresh));
        }
      }),
    closeSession: () => Effect.void,
    append: (ref, entries) => repo.append(ref, entries),
    load: (ref) =>
      repo.load(ref).pipe(
        Effect.map(Option.match({ onNone: () => [], onSome: (entries) => entries.map((entry) => decodeHistory(entry.native)) })),
      ),
    listSessions: (projectId) => repo.list(projectId).pipe(Effect.map((all) => all.map((s) => s.sessionId))),
    listSessionMetadata: (projectId): Effect.Effect<ReadonlyArray<SessionSummary>> => repo.list(projectId),
    delete: (sessionId) => repo.remove(sessionId),
    listSubagentSession: (sessionId) => repo.subagents(sessionId),
  };
  return adapter;
});

/** Writes `seededSessions` for `cwd` into the repo, oldest first so the newest sorts on top. */
export const seedSessions = (cwd: string) =>
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const projectId = projectIdOfCwd(cwd);
    yield* repo.ensureProject(projectId, cwd);
    for (const seeded of [...seededSessions].reverse()) {
      const sessionId = SessionId.make(randomUUID());
      yield* repo.createSession({ sessionId, projectId, cwd, provider: 'Claude', providerSessionId: ProviderSessionId.make(`mock-${sessionId}`) });
      yield* repo.setAutoTitle(sessionId, seeded.title);
      yield* repo.append(
        { projectId, sessionId },
        seeded.items.map((native) => ({ kind: native._tag, native })),
      );
      yield* Effect.sleep('5 millis');
    }
  });

/** Registry with only the mock adapter; seeds the demo sessions once. */
export const layerMockSdkAdapterRegistry = Layer.effect(
  SdkAdapterRegistry,
  Effect.gen(function* () {
    const mock = yield* makeMockSdkAdapter;
    yield* seedSessions(process.cwd());
    return SdkAdapterRegistry.of({
      defaultProvider: 'Claude',
      get: (provider) =>
        provider === 'Claude'
          ? Effect.succeed(mock)
          : Effect.fail(new ChatError({ reason: 'Unsupported', detail: `No mock adapter for ${provider}` })),
    });
  }),
);
