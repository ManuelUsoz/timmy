import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { AgentId, SessionId } from '../../src/shared/chat/ids.model';
import { ProjectId, ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { makeClaudeSessionStore } from './claude-session-store';

const projectId = ProjectId.make('p1');
const sessionId = SessionId.make('ours');
const key = (subpath?: string) => ({
  projectKey: 'ignored',
  sessionId: 'sdk-id',
  ...(subpath === undefined ? {} : { subpath }),
});

const withStore = <A, E>(body: (store: Effect.Success<typeof makeClaudeSessionStore>) => Effect.Effect<A, E, SessionRepo>) =>
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    yield* repo.createSession({
      sessionId,
      projectId,
      cwd: '/work',
      provider: 'Claude',
      providerSessionId: ProviderSessionId.make('sdk-id'),
    });
    return yield* body(yield* makeClaudeSessionStore);
  }).pipe(Effect.provide(layerSessionRepo(':memory:')));

describe('Claude SessionStore bridge', () => {
  it.effect('mirrors main and subagent entries into the Timmy session and reads them back', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const repo = yield* SessionRepo;
        yield* Effect.promise(() => store.append(key(), [{ type: 'user', uuid: 'u1' }]));
        yield* Effect.promise(() => store.append(key('subagents/agent-a1'), [{ type: 'assistant', uuid: 'u2' }]));
        expect(yield* Effect.promise(() => store.load(key()))).toEqual([{ type: 'user', uuid: 'u1' }]);
        expect(yield* Effect.promise(() => store.load(key('subagents/agent-a1')))).toEqual([
          { type: 'assistant', uuid: 'u2' },
        ]);
        expect(yield* Effect.promise(() => store.listSubkeys?.({ projectKey: 'ignored', sessionId: 'sdk-id' }) ?? Promise.resolve([]))).toEqual([
          'subagents/agent-a1',
        ]);
        expect(yield* repo.subagents(sessionId)).toEqual([AgentId.make('a1')]);
      }),
    ));

  it.effect('loads null for a transcript never written, and for a session that is not ours', () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* Effect.promise(() => store.load(key()))).toBeNull();
        expect(yield* Effect.promise(() => store.load({ projectKey: 'p', sessionId: 'unknown' }))).toBeNull();
      }),
    ));

  it.effect('rejects an append for a session that is not ours, so the SDK reports a mirror error', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.promise(() =>
          store.append({ projectKey: 'p', sessionId: 'unknown' }, [{ type: 'user' }]).then(
            () => 'stored',
            () => 'rejected',
          ),
        );
        expect(outcome).toBe('rejected');
      }),
    ));

  it.effect('rejects a sidecar transcript of a shape it cannot name', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.promise(() =>
          store.append(key('weird/path'), [{ type: 'user' }]).then(
            () => 'stored',
            () => 'rejected',
          ),
        );
        expect(outcome).toBe('rejected');
        expect(Option.isNone(yield* (yield* SessionRepo).load({ projectId, sessionId }))).toBe(true);
      }),
    ));
});
