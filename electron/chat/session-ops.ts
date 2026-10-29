import { Effect } from 'effect';
import { ProviderId } from '../../src/shared/chat/provider.model';
import { SessionRepo } from '../sessions/session-repo';
import { SdkAdapter } from './sdk-adapter';

/**
 * The stored-session operations every adapter shares: they only move rows, so a new provider
 * spreads these in and writes just its own `load`, the decoding of its native entries.
 */
export const makeSessionOps = (provider: ProviderId) =>
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    return {
      append: repo.append,
      listSessions: (projectId) =>
        repo.list(projectId).pipe(
          Effect.map((sessions) =>
            sessions.filter((session) => session.provider === provider).map((session) => session.sessionId),
          ),
        ),
      listSessionMetadata: (projectId) =>
        repo.list(projectId).pipe(Effect.map((sessions) => sessions.filter((session) => session.provider === provider))),
      delete: repo.remove,
      listSubagentSession: repo.subagents,
    } satisfies Partial<SdkAdapter>;
  });
