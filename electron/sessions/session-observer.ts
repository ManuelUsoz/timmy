import { Context, Effect, Layer, Ref } from 'effect';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { PermissionRequestId, QuestionRequestId, SessionId } from '../../src/shared/chat/ids.model';
import { UserMessage } from '../../src/shared/chat/session.model';
import { SessionRepo } from './session-repo';

/** What the session is doing right now, as far as the events say. */
export interface SessionState {
  readonly running: boolean;
  readonly pendingPermissions: ReadonlySet<PermissionRequestId>;
  readonly pendingQuestions: ReadonlySet<QuestionRequestId>;
}

export const initialSessionState: SessionState = {
  running: false,
  pendingPermissions: new Set(),
  pendingQuestions: new Set(),
};

const without = <A>(set: ReadonlySet<A>, value: A): ReadonlySet<A> => {
  const next = new Set(set);
  next.delete(value);
  return next;
};

export const reduceSessionState = (state: SessionState, event: ChatEvent): SessionState => {
  switch (event._tag) {
    case 'TurnStarted':
      return { ...state, running: true };
    case 'TurnFinished':
      return initialSessionState;
    case 'PermissionRequested':
      return { ...state, pendingPermissions: new Set(state.pendingPermissions).add(event.request.id) };
    case 'PermissionResolved':
      return { ...state, pendingPermissions: without(state.pendingPermissions, event.requestId) };
    case 'QuestionAsked':
      return { ...state, pendingQuestions: new Set(state.pendingQuestions).add(event.request.id) };
    case 'QuestionResolved':
      return { ...state, pendingQuestions: without(state.pendingQuestions, event.requestId) };
    default:
      return state;
  }
};

const TITLE_LIMIT = 80;

/** The session name taken from the first message: its first non-empty line, squashed and cut. */
export const titleFromMessage = (text: string): string => {
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(/\s+/g, ' ').trim())
    .find((candidate) => candidate !== '');
  if (line === undefined) return 'New session';
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line;
};

/**
 * Watches what flows through a chat session and keeps its stored record and live state
 * current. The provider transcript itself is written by the adapter. The observer never
 * fails the chat: whatever goes wrong here is dropped.
 */
export class SessionObserver extends Context.Service<
  SessionObserver,
  {
    /** Names the session after its first message and stamps it as updated. */
    readonly userMessage: (message: UserMessage) => Effect.Effect<void>;
    readonly event: (event: ChatEvent) => Effect.Effect<void>;
    readonly state: (sessionId: SessionId) => Effect.Effect<SessionState>;
    /** Drops the live state of a closed session. */
    readonly forget: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()('sessions/SessionObserver') {}

export const layerSessionObserver = Layer.effect(
  SessionObserver,
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    const states = yield* Ref.make<ReadonlyMap<SessionId, SessionState>>(new Map());

    const isolated = <A, E>(effect: Effect.Effect<A, E>) => effect.pipe(Effect.catchCause(() => Effect.void));

    return SessionObserver.of({
      userMessage: (message) =>
        isolated(
          repo.setAutoTitle(message.sessionId, titleFromMessage(message.text)).pipe(
            Effect.andThen(repo.touch(message.sessionId)),
          ),
        ),
      event: (event) =>
        isolated(
          Effect.gen(function* () {
            yield* Ref.update(states, (map) =>
              new Map(map).set(event.sessionId, reduceSessionState(map.get(event.sessionId) ?? initialSessionState, event)),
            );
            if (event._tag === 'TurnFinished') yield* repo.touch(event.sessionId);
          }),
        ),
      state: (sessionId) => Ref.get(states).pipe(Effect.map((map) => map.get(sessionId) ?? initialSessionState)),
      forget: (sessionId) =>
        Ref.update(states, (map) => {
          const next = new Map(map);
          next.delete(sessionId);
          return next;
        }),
    });
  }),
);
