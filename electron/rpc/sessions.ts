import { Effect } from 'effect';
import { SessionsRpcs } from '../../src/shared/sessions/sessions.rpc';
import { SessionsService } from '../sessions/sessions-service';

export const layerSessionsHandlers = SessionsRpcs.toLayer(
  Effect.gen(function* () {
    const sessions = yield* SessionsService;
    return {
      'Sessions.list': ({ cwd }) => sessions.list(cwd),
      'Sessions.history': ({ ref }) => sessions.history(ref),
      'Sessions.listSubagents': ({ sessionId }) => sessions.listSubagents(sessionId),
      'Sessions.rename': ({ sessionId, title }) => sessions.rename(sessionId, title),
      'Sessions.delete': ({ sessionId }) => sessions.delete(sessionId),
      'Sessions.changes': () => sessions.changes,
    };
  }),
);
