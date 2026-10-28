import type { Options, PermissionResult, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from '@effect/vitest';
import { beforeEach, vi } from 'vitest';
import { Effect, Stream } from 'effect';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { OptionId, PermissionRequestId, QuestionId } from '../../src/shared/chat/ids.model';
import { SessionOptions } from '../../src/shared/chat/session.model';
import { makeClaudeAgentSdkAdapter } from './claude-agent-sdk-adapter';
import { ALLOW_ONCE, REJECT_ONCE } from './claude-interaction';

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

const options: SessionOptions = { provider: 'Claude', cwd: '/work', permissionMode: 'Ask' };

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

const ready = Effect.gen(function* () {
  const adapter = yield* makeClaudeAgentSdkAdapter();
  yield* adapter.startup;
  const sessionId = yield* adapter.startSession(options);
  return { adapter, sessionId };
});

const tags = (events: ReadonlyArray<ChatEvent>) => events.map((e) => e._tag);

describe('ClaudeAgentSdkAdapter', () => {
  it.effect('refuses to start when Claude Code is not logged in', () =>
    Effect.gen(function* () {
      setLoggedIn(false);
      const adapter = yield* makeClaudeAgentSdkAdapter();
      const error = yield* adapter.startup.pipe(Effect.flip);
      expect(error.reason).toBe('AuthMissing');
    }));

  it.effect('streams a turn, then resumes the session on the next one', () =>
    Effect.gen(function* () {
      const runs: FakeRun[] = [];
      scriptSdk(async function* () {
        yield init;
        yield success;
      }, runs);
      const { adapter, sessionId } = yield* ready;
      const first = yield* Stream.runCollect(adapter.send({ sessionId, text: 'hi', files: ['a.ts'] }));
      yield* Stream.runCollect(adapter.send({ sessionId, text: 'again', files: [] }));
      expect(tags(first)).toEqual(['TurnStarted', 'SessionStarted', 'AgentSpawned', 'UsageUpdated', 'TurnFinished']);
      expect(runs[0]?.prompt).toBe('hi\n\n@a.ts');
      expect(runs[0]?.options).toMatchObject({ sessionId, includePartialMessages: true, cwd: '/work', permissionMode: 'default' });
      expect(runs[1]?.options).toMatchObject({ resume: sessionId });
      expect(runs[1]?.options?.sessionId).toBeUndefined();
    }));

  it.effect('parks canUseTool on a permission request until the user answers', () =>
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

  it.effect('denies the tool when the user rejects the permission', () =>
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

  it.effect('turns AskUserQuestion into a question and returns the chosen labels as answers', () =>
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

  it.effect('interrupt cancels a turn parked on a permission request', () =>
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

  it.effect('reports a crashed CLI as a failed turn instead of throwing', () =>
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

  it.effect('fails resolvePermission for an unknown request', () =>
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
