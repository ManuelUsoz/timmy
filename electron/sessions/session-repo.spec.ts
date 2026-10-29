import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { AgentId, SessionId } from '../../src/shared/chat/ids.model';
import { ProjectId, ProviderSessionId, type TranscriptRef } from '../../src/shared/sessions/sessions.model';
import { layerSessionRepo, SessionRepo, type NewSession } from './session-repo';

const projectId = ProjectId.make('p1');
const session = (id: string, overrides: Partial<NewSession> = {}): NewSession => ({
  sessionId: SessionId.make(id),
  projectId,
  cwd: '/work',
  provider: 'Claude',
  providerSessionId: ProviderSessionId.make(`native-${id}`),
  ...overrides,
});
const mainRef = (id: string): TranscriptRef => ({ projectId, sessionId: SessionId.make(id) });
const agentRef = (id: string, agent: string): TranscriptRef => ({ ...mainRef(id), subagent: AgentId.make(agent) });

const withRepo = <A, E>(body: (repo: SessionRepo['Service']) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* body(yield* SessionRepo);
  }).pipe(Effect.provide(layerSessionRepo(':memory:')));

describe('SessionRepo', () => {
  it.effect('finds a session by our id and by the SDK id', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        yield* repo.createSession(session('s1'));
        const byId = yield* repo.get(SessionId.make('s1'));
        const byProvider = yield* repo.findByProvider('Claude', ProviderSessionId.make('native-s1'));
        expect(byId).toEqual(byProvider);
        expect(Option.getOrThrow(byId)).toMatchObject({ projectId, cwd: '/work', provider: 'Claude', title: '' });
        expect(Option.isNone(yield* repo.get(SessionId.make('nope')))).toBe(true);
      }),
    ));

  it.effect('appends in order and returns the native entries verbatim', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        yield* repo.createSession(session('s1'));
        const native = { type: 'user', uuid: 'u1', nested: { a: [1, 2] } };
        yield* repo.append(mainRef('s1'), [{ kind: 'user', uuid: 'u1', timestamp: 't1', native }]);
        yield* repo.append(mainRef('s1'), [{ kind: 'custom-title', native: { type: 'custom-title' } }]);
        const loaded = Option.getOrThrow(yield* repo.load(mainRef('s1')));
        expect(loaded).toEqual([
          { kind: 'user', uuid: 'u1', timestamp: 't1', native },
          { kind: 'custom-title', native: { type: 'custom-title' } },
        ]);
      }),
    ));

  it.effect('ignores an entry whose uuid is already stored, so a retried batch is harmless', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        yield* repo.createSession(session('s1'));
        const batch = [{ kind: 'user', uuid: 'u1', native: { type: 'user' } }];
        yield* repo.append(mainRef('s1'), batch);
        yield* repo.append(mainRef('s1'), batch);
        expect(Option.getOrThrow(yield* repo.load(mainRef('s1')))).toHaveLength(1);
      }),
    ));

  it.effect('keeps main and subagent transcripts apart and lists the subagents', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        yield* repo.createSession(session('s1'));
        yield* repo.append(mainRef('s1'), [{ kind: 'user', uuid: 'u1', native: 'main' }]);
        yield* repo.append(agentRef('s1', 'a1'), [{ kind: 'user', uuid: 'u1', native: 'sub' }]);
        expect(Option.getOrThrow(yield* repo.load(mainRef('s1'))).map((e) => e.native)).toEqual(['main']);
        expect(Option.getOrThrow(yield* repo.load(agentRef('s1', 'a1'))).map((e) => e.native)).toEqual(['sub']);
        expect(yield* repo.subagents(SessionId.make('s1'))).toEqual(['a1']);
      }),
    ));

  it.effect('has nothing to load for a transcript never written', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        yield* repo.createSession(session('s1'));
        expect(Option.isNone(yield* repo.load(mainRef('s1')))).toBe(true);
        expect(Option.isNone(yield* repo.load(agentRef('s1', 'a1')))).toBe(true);
      }),
    ));

  it.effect('lists the sessions of one project, most recently updated first', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        yield* repo.createSession(session('old'));
        yield* repo.createSession(session('other', { projectId: ProjectId.make('p2') }));
        yield* repo.createSession(session('new'));
        yield* TestClock.adjust('1 second');
        yield* repo.append(mainRef('new'), [{ kind: 'user', native: {} }]);
        expect((yield* repo.list(projectId)).map((s) => s.sessionId)).toEqual(['new', 'old']);
      }),
    ));

  it.effect('names a session once from its first message, and a rename always wins', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        const id = SessionId.make('s1');
        yield* repo.createSession(session('s1'));
        yield* repo.setAutoTitle(id, 'first');
        yield* repo.setAutoTitle(id, 'second');
        expect(Option.getOrThrow(yield* repo.get(id)).title).toBe('first');
        yield* repo.rename(id, 'mine');
        yield* repo.setAutoTitle(id, 'third');
        expect(Option.getOrThrow(yield* repo.get(id)).title).toBe('mine');
      }),
    ));

  it.effect('a rename before any message keeps the auto title away', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        const id = SessionId.make('s1');
        yield* repo.createSession(session('s1'));
        yield* repo.rename(id, '');
        yield* repo.setAutoTitle(id, 'first');
        expect(Option.getOrThrow(yield* repo.get(id)).title).toBe('');
      }),
    ));

  it.effect('removes a session with all its transcripts', () =>
    withRepo((repo) =>
      Effect.gen(function* () {
        const id = SessionId.make('s1');
        yield* repo.createSession(session('s1'));
        yield* repo.append(mainRef('s1'), [{ kind: 'user', native: 1 }]);
        yield* repo.append(agentRef('s1', 'a1'), [{ kind: 'user', native: 2 }]);
        yield* repo.remove(id);
        expect(Option.isNone(yield* repo.get(id))).toBe(true);
        expect(Option.isNone(yield* repo.load(mainRef('s1')))).toBe(true);
        expect(yield* repo.subagents(id)).toEqual([]);
      }),
    ));
});
