import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option } from 'effect';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { OptionId, PermissionRequestId, QuestionRequestId, SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { ProjectId, ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import {
  initialSessionState,
  layerSessionObserver,
  reduceSessionState,
  SessionObserver,
  titleFromMessage,
} from './session-observer';
import { layerSessionRepo, SessionRepo } from './session-repo';

const sessionId = SessionId.make('s1');
const turnId = TurnId.make('t1');
const permissionId = PermissionRequestId.make('perm1');
const questionId = QuestionRequestId.make('q1');

// The reducer only reads the request id, so the rest of the request is left out of these fixtures.
const event = (value: object): ChatEvent => value as unknown as ChatEvent;

describe('titleFromMessage', () => {
  it('takes the first non-empty line, squashed', () => {
    expect(titleFromMessage('\n  Fix   the\tlogin bug \nthen more')).toBe('Fix the login bug');
  });

  it('cuts a long line', () => {
    const title = titleFromMessage('x'.repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back when the message is blank', () => {
    expect(titleFromMessage('  \n ')).toBe('New session');
  });
});

describe('reduceSessionState', () => {
  it('follows a turn with a permission and a question asked and answered', () => {
    const states = [
      event({ _tag: 'TurnStarted', sessionId, turnId }),
      event({ _tag: 'PermissionRequested', sessionId, request: { id: permissionId } }),
      event({ _tag: 'QuestionAsked', sessionId, request: { id: questionId } }),
      event({ _tag: 'PermissionResolved', sessionId, requestId: permissionId }),
      event({ _tag: 'QuestionResolved', sessionId, requestId: questionId }),
      event({ _tag: 'TurnFinished', sessionId, turnId }),
    ].reduce(
      (acc, e) => [...acc, reduceSessionState(acc[acc.length - 1] ?? initialSessionState, e)],
      [] as ReadonlyArray<ReturnType<typeof reduceSessionState>>,
    );
    expect(states.map((s) => [s.running, s.pendingPermissions.size, s.pendingQuestions.size])).toEqual([
      [true, 0, 0],
      [true, 1, 0],
      [true, 1, 1],
      [true, 0, 1],
      [true, 0, 0],
      [false, 0, 0],
    ]);
  });

  it('a finished turn drops whatever was still pending', () => {
    const waiting = reduceSessionState(
      reduceSessionState(initialSessionState, event({ _tag: 'TurnStarted', sessionId, turnId })),
      event({ _tag: 'PermissionRequested', sessionId, request: { id: permissionId } }),
    );
    expect(reduceSessionState(waiting, event({ _tag: 'TurnFinished', sessionId, turnId }))).toEqual(initialSessionState);
  });
});

const layer = layerSessionObserver.pipe(Layer.provideMerge(layerSessionRepo(':memory:')));

describe('SessionObserver', () => {
  it.effect('names the stored session after the first message', () =>
    Effect.gen(function* () {
      const repo = yield* SessionRepo;
      const observer = yield* SessionObserver;
      yield* repo.createSession({
        sessionId,
        projectId: ProjectId.make('p1'),
        cwd: '/work',
        provider: 'Claude',
        providerSessionId: ProviderSessionId.make('native'),
      });
      yield* observer.userMessage({ sessionId, text: 'Fix the bug', files: [] });
      yield* observer.userMessage({ sessionId, text: 'Something else', files: [] });
      expect((yield* repo.get(sessionId)).pipe(Option.map((s) => s.title))).toEqual(Option.some('Fix the bug'));
    }).pipe(Effect.provide(layer)));

  it.effect('tracks the live state of a session and forgets it when closed', () =>
    Effect.gen(function* () {
      const observer = yield* SessionObserver;
      yield* observer.event(event({ _tag: 'TurnStarted', sessionId, turnId }));
      yield* observer.event(
        event({ _tag: 'PermissionRequested', sessionId, request: { id: permissionId, options: [OptionId.make('o')] } }),
      );
      expect(yield* observer.state(sessionId)).toMatchObject({ running: true });
      expect((yield* observer.state(sessionId)).pendingPermissions.has(permissionId)).toBe(true);
      yield* observer.forget(sessionId);
      expect(yield* observer.state(sessionId)).toEqual(initialSessionState);
    }).pipe(Effect.provide(layer)));

  it.effect('does not fail the chat when the session is not stored', () =>
    Effect.gen(function* () {
      const observer = yield* SessionObserver;
      yield* observer.userMessage({ sessionId: SessionId.make('ghost'), text: 'hi', files: [] });
      yield* observer.event(event({ _tag: 'TurnFinished', sessionId: SessionId.make('ghost'), turnId }));
    }).pipe(Effect.provide(layer)));
});
