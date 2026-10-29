import type { Options, PermissionResult, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from '@effect/vitest';
import { beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Effect, Stream, type Scope } from 'effect';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { OptionId, PermissionRequestId, QuestionId, SessionId } from '../../src/shared/chat/ids.model';
import { SessionOptions } from '../../src/shared/chat/session.model';
import { ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { makeClaudeAgentSdkAdapter } from './claude-agent-sdk-adapter';
import { ALLOW_ONCE, REJECT_ONCE } from './claude-interaction';
import { SdkAdapter } from './sdk-adapter';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execFile: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

/** What `claude auth status` prints; the login probe only reads `loggedIn`. */
const setLoggedIn = (loggedIn: boolean) =>
  mocks.execFile.mockImplementation((_exe, _args, _opts, done: (error: Error | null, out: string) => void) =>
    done(null, JSON.stringify({ loggedIn })),
  );

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  setLoggedIn(true);
});

const sdkMessage = (message: object): SDKMessage => message as unknown as SDKMessage;

const init = sdkMessage({ type: 'system', subtype: 'init', model: 'claude-test' });
const success = sdkMessage({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 10,
  total_cost_usd: 0.01,
  result: 'ok',
  modelUsage: {},
});

const toolOptions = (toolUseID: string) => ({
  signal: new AbortController().signal,
  toolUseID,
  requestId: toolUseID,
});

const options: SessionOptions = { provider: 'Claude', cwd: '/work', permissionMode: 'Default' };

interface FakeRun {
  readonly options: Options | undefined;
  readonly prompt: string;
}

/** A scripted Claude CLI: the script receives the query options, so it can call `canUseTool`. */
const scriptSdk = (script: (options: Options) => AsyncGenerator<SDKMessage>, runs: FakeRun[] = []): void => {
  mocks.query.mockImplementation(({ prompt, options: queryOptions }: { prompt: string; options?: Options }) => {
    runs.push({ options: queryOptions, prompt });
    return Object.assign(script(queryOptions ?? {}), { close: () => undefined }) as unknown as Query;
  });
};

/** `it.effect` with an in-memory `SessionRepo`, which the adapter needs for its stored sessions. */
const itRepo = <E>(name: string, body: () => Effect.Effect<void, E, SessionRepo | Scope.Scope>) =>
  it.effect(name, () => body().pipe(Effect.provide(layerSessionRepo(':memory:'))));

/** Opens a session under a fresh Timmy id, which is what the tests then address it by. */
const openSession = (adapter: SdkAdapter, sessionOptions: SessionOptions) =>
  Effect.gen(function* () {
    const sessionId = SessionId.make(randomUUID());
    yield* adapter.startSession(sessionOptions, { sessionId });
    return sessionId;
  });

const ready = Effect.gen(function* () {
  const adapter = yield* makeClaudeAgentSdkAdapter();
  yield* adapter.startup;
  const sessionId = yield* openSession(adapter, options);
  return { adapter, sessionId };
});

const tags = (events: ReadonlyArray<ChatEvent>) => events.map((e) => e._tag);

describe('ClaudeAgentSdkAdapter', () => {
  itRepo('refuses to start when Claude Code is not logged in', () =>
    Effect.gen(function* () {
      setLoggedIn(false);
      const adapter = yield* makeClaudeAgentSdkAdapter();
      const error = yield* adapter.startup.pipe(Effect.flip);
      expect(error.reason).toBe('AuthMissing');
    }));

  itRepo('streams a turn, then resumes the session on the next one', () =>
    Effect.gen(function* () {
      const runs: FakeRun[] = [];
      scriptSdk(async function* () {
        yield init;
        yield success;
      }, runs);
      const adapter = yield* makeClaudeAgentSdkAdapter();
      yield* adapter.startup;
      const sessionId = SessionId.make(randomUUID());
      const providerSessionId = yield* adapter.startSession(options, { sessionId });
      expect(providerSessionId).not.toBe(sessionId);
      const first = yield* Stream.runCollect(adapter.send({ sessionId, text: 'hi', files: ['a.ts'] }));
      yield* Stream.runCollect(adapter.send({ sessionId, text: 'again', files: [] }));
      expect(tags(first)).toEqual(['TurnStarted', 'SessionStarted', 'AgentSpawned', 'UsageUpdated', 'TurnFinished']);
      expect(runs[0]?.prompt).toBe('hi\n\n@a.ts');
      expect(runs[0]?.options).toMatchObject({
        sessionId: providerSessionId,
        includePartialMessages: true,
        cwd: '/work',
        permissionMode: 'default',
      });
      expect(runs[0]?.options?.sessionStore).toBeDefined();
      expect(runs[1]?.options).toMatchObject({ resume: providerSessionId });
      expect(runs[1]?.options?.sessionId).toBeUndefined();
    }));

  itRepo('continues a stored session under the SDK id it was stored with', () =>
    Effect.gen(function* () {
      const runs: FakeRun[] = [];
      scriptSdk(async function* () {
        yield init;
        yield success;
      }, runs);
      const adapter = yield* makeClaudeAgentSdkAdapter();
      yield* adapter.startup;
      const sessionId = SessionId.make(randomUUID());
      const stored = ProviderSessionId.make('stored-claude-id');
      const providerSessionId = yield* adapter.startSession(
        { ...options, resume: sessionId },
        { sessionId, resumeProviderSessionId: stored },
      );
      yield* Stream.runCollect(adapter.send({ sessionId, text: 'hi', files: [] }));
      expect(providerSessionId).toBe(stored);
      expect(runs[0]?.options).toMatchObject({ resume: stored });
    }));

  itRepo('maps the Auto permission mode to the SDK auto mode', () =>
    Effect.gen(function* () {
      const runs: FakeRun[] = [];
      scriptSdk(async function* () {
        yield init;
        yield success;
      }, runs);
      const adapter = yield* makeClaudeAgentSdkAdapter();
      yield* adapter.startup;
      const sessionId = yield* openSession(adapter, { ...options, permissionMode: 'Auto' });
      yield* Stream.runCollect(adapter.send({ sessionId, text: 'hi', files: [] }));
      expect(runs[0]?.options).toMatchObject({ permissionMode: 'auto' });
    }));

  itRepo('lists the static models with their efforts', () =>
    Effect.gen(function* () {
      const adapter = yield* makeClaudeAgentSdkAdapter();
      const models = yield* adapter.models;
      const efforts = ['Default', 'Low', 'Medium', 'High', 'XHigh'];
      expect(models).toEqual([
        { id: 'claude-opus-5-5', efforts },
        { id: 'claude-sonnet-5-5', efforts },
        { id: 'claude-haiku-5-5', efforts },
      ]);
    }));

  itRepo('lists commands from a probe query that loads user and project settings, then closes it', () =>
    Effect.gen(function* () {
      const runs: FakeRun[] = [];
      const close = vi.fn();
      mocks.query.mockImplementation(({ prompt, options: queryOptions }: { prompt: string; options?: Options }) => {
        runs.push({ options: queryOptions, prompt });
        return {
          supportedCommands: () =>
            Promise.resolve([
              { name: 'compact', description: 'Compact', argumentHint: '[focus]', builtin: true },
              { name: 'deploy', description: 'Project command', argumentHint: '' },
            ]),
          close,
        } as unknown as Query;
      });
      const adapter = yield* makeClaudeAgentSdkAdapter();
      yield* adapter.startup;
      const commands = yield* adapter.listCommands({ cwd: '/work' });
      expect(commands).toEqual([
        { name: 'compact', description: 'Compact', argumentHint: '[focus]' },
        { name: 'deploy', description: 'Project command', argumentHint: '' },
      ]);
      expect(runs[0]?.options).toMatchObject({ cwd: '/work', settingSources: ['user', 'project', 'local'] });
      expect(close).toHaveBeenCalledTimes(1);
    }));

  itRepo('fails listCommands before the adapter is started', () =>
    Effect.gen(function* () {
      const adapter = yield* makeClaudeAgentSdkAdapter();
      const error = yield* adapter.listCommands({ cwd: '/work' }).pipe(Effect.flip);
      expect(error.reason).toBe('AdapterNotReady');
    }));

  itRepo('maps effort to the SDK option and omits it for Default', () =>
    Effect.gen(function* () {
      const runs: FakeRun[] = [];
      scriptSdk(async function* () {
        yield init;
        yield success;
      }, runs);
      const adapter = yield* makeClaudeAgentSdkAdapter();
      yield* adapter.startup;
      const high = yield* openSession(adapter, { ...options, effort: 'XHigh' });
      const plain = yield* openSession(adapter, { ...options, effort: 'Default' });
      yield* Stream.runCollect(adapter.send({ sessionId: high, text: 'hi', files: [] }));
      yield* Stream.runCollect(adapter.send({ sessionId: plain, text: 'hi', files: [] }));
      expect(runs[0]?.options).toMatchObject({ effort: 'xhigh' });
      expect(runs[1]?.options?.effort).toBeUndefined();
    }));

  itRepo('parks canUseTool on a permission request until the user answers', () =>
    Effect.gen(function* () {
      const decisions: PermissionResult[] = [];
      scriptSdk(async function* (queryOptions) {
        yield init;
        const input = { file_path: 'a.ts', old_string: 'a', new_string: 'b' };
        decisions.push(
          (await queryOptions.canUseTool?.('Edit', input, toolOptions('tu1'))) as PermissionResult,
        );
        yield success;
      });
      const { adapter, sessionId } = yield* ready;
      const events = yield* Stream.runCollect(
        adapter.send({ sessionId, text: 'go', files: [] }).pipe(
          Stream.tap((event) =>
            event._tag === 'PermissionRequested'
              ? adapter.resolvePermission(sessionId, {
                  _tag: 'Selected',
                  requestId: event.request.id,
                  optionId: ALLOW_ONCE,
                })
              : Effect.void,
          ),
        ),
      );
      const requested = events.find((e) => e._tag === 'PermissionRequested');
      expect(requested?._tag === 'PermissionRequested' && requested.request.toolCall).toMatchObject({
        kind: 'Edit',
        locations: [{ path: 'a.ts' }],
      });
      expect(tags(events)).toContain('PermissionResolved');
      expect(decisions).toEqual([{ behavior: 'allow', updatedInput: { file_path: 'a.ts', old_string: 'a', new_string: 'b' } }]);
    }));

  itRepo('denies the tool when the user rejects the permission', () =>
    Effect.gen(function* () {
      const decisions: PermissionResult[] = [];
      scriptSdk(async function* (queryOptions) {
        yield init;
        decisions.push(
          (await queryOptions.canUseTool?.('Bash', { command: 'rm -rf x' }, toolOptions('tu1'))) as PermissionResult,
        );
        yield success;
      });
      const { adapter, sessionId } = yield* ready;
      yield* Stream.runCollect(
        adapter.send({ sessionId, text: 'go', files: [] }).pipe(
          Stream.tap((event) =>
            event._tag === 'PermissionRequested'
              ? adapter.resolvePermission(sessionId, { _tag: 'Selected', requestId: event.request.id, optionId: REJECT_ONCE })
              : Effect.void,
          ),
        ),
      );
      expect(decisions[0]?.behavior).toBe('deny');
    }));

  itRepo('turns AskUserQuestion into a question and returns the chosen labels as answers', () =>
    Effect.gen(function* () {
      const decisions: PermissionResult[] = [];
      scriptSdk(async function* (queryOptions) {
        yield init;
        decisions.push(
          (await queryOptions.canUseTool?.(
            'AskUserQuestion',
            {
              questions: [
                {
                  question: 'Which libs?',
                  header: 'Libs',
                  multiSelect: true,
                  options: [
                    { label: 'A', description: 'a' },
                    { label: 'B', description: 'b' },
                  ],
                },
              ],
            },
            toolOptions('q1'),
          )) as PermissionResult,
        );
        yield success;
      });
      const { adapter, sessionId } = yield* ready;
      yield* Stream.runCollect(
        adapter.send({ sessionId, text: 'go', files: [] }).pipe(
          Stream.tap((event) =>
            event._tag === 'QuestionAsked'
              ? adapter.answerQuestion(sessionId, {
                  _tag: 'Answered',
                  requestId: event.request.id,
                  answers: [
                    {
                      questionId: QuestionId.make('q0'),
                      selected: [OptionId.make('0-0'), OptionId.make('0-1')],
                      custom: 'C',
                    },
                  ],
                })
              : Effect.void,
          ),
        ),
      );
      expect(decisions[0]).toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which libs?': 'A, B, C' } } });
    }));

  itRepo('interrupt cancels a turn parked on a permission request', () =>
    Effect.gen(function* () {
      scriptSdk(async function* (queryOptions) {
        yield init;
        await queryOptions.canUseTool?.('Bash', { command: 'sleep 99' }, toolOptions('tu1'));
        // Like the real SDK after an abort: the generator ends without a result.
      });
      const { adapter, sessionId } = yield* ready;
      const events = yield* Stream.runCollect(
        adapter.send({ sessionId, text: 'go', files: [] }).pipe(
          Stream.tap((event) => (event._tag === 'PermissionRequested' ? adapter.interrupt(sessionId) : Effect.void)),
        ),
      );
      const finished = events.find((e) => e._tag === 'TurnFinished');
      expect(finished?._tag === 'TurnFinished' && finished.outcome).toBe('Cancelled');
    }));

  itRepo('reports a crashed CLI as a failed turn instead of throwing', () =>
    Effect.gen(function* () {
      scriptSdk(async function* () {
        yield init;
        throw new globalThis.Error('spawn failed');
      });
      const { adapter, sessionId } = yield* ready;
      const events = yield* Stream.runCollect(adapter.send({ sessionId, text: 'go', files: [] }));
      const finished = events.find((e) => e._tag === 'TurnFinished');
      expect(finished?._tag === 'TurnFinished' && finished.outcome).toBe('Failed');
      expect(finished?._tag === 'TurnFinished' && finished.detail).toContain('spawn failed');
    }));

  itRepo('fails resolvePermission for an unknown request', () =>
    Effect.gen(function* () {
      const { adapter, sessionId } = yield* ready;
      const error = yield* adapter
        .resolvePermission(sessionId, {
          _tag: 'Cancelled',
          requestId: PermissionRequestId.make('nope'),
        })
        .pipe(Effect.flip);
      expect(error.reason).toBe('RequestNotFound');
    }));
});
