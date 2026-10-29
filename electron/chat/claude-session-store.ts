import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { Effect, Option } from 'effect';
import { AgentId } from '../../src/shared/chat/ids.model';
import { ProviderSessionId, type TranscriptRef } from '../../src/shared/sessions/sessions.model';
import { SessionRepo, type TranscriptEntry } from '../sessions/session-repo';

const SUBAGENT_SUBPATH = /^subagents\/agent-(.+)$/;

const isStoreEntry = (value: unknown): value is SessionStoreEntry =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';

const toEntry = (entry: SessionStoreEntry): TranscriptEntry => ({
  kind: entry.type,
  native: entry,
  ...(entry.uuid === undefined ? {} : { uuid: entry.uuid }),
  ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
});

/**
 * Hands the repo to the Claude SDK as its `SessionStore`, so the SDK mirrors every transcript
 * entry (subagents included) into Timmy's storage and reads it back on resume. Keys carry the
 * SDK's own session id and `projectKey`; only the session id is used, to find the Timmy
 * session. The SDK API is `@alpha`: keep every touch point to it in this file.
 *
 * The SDK calls these through Promises, so each one runs its effect to completion here.
 */
export const makeClaudeSessionStore = Effect.gen(function* () {
  const repo = yield* SessionRepo;

  /** `None` when the SDK session is not one of ours, e.g. nothing was stored for it yet. */
  const toRef = (key: { readonly sessionId: string; readonly subpath?: string | undefined }) =>
    Effect.gen(function* () {
      const session = yield* repo.findByProvider('Claude', ProviderSessionId.make(key.sessionId));
      if (Option.isNone(session)) return Option.none<TranscriptRef>();
      const base = { projectId: session.value.projectId, sessionId: session.value.sessionId };
      if (key.subpath === undefined) return Option.some<TranscriptRef>(base);
      const agent = SUBAGENT_SUBPATH.exec(key.subpath)?.[1];
      // A sidecar of a shape we do not know cannot be stored without losing its identity.
      if (agent === undefined) return yield* Effect.die(`Unsupported Claude transcript subpath ${key.subpath}`);
      return Option.some<TranscriptRef>({ ...base, subagent: AgentId.make(agent) });
    });

  const store: SessionStore = {
    append: (key: SessionKey, entries: SessionStoreEntry[]) =>
      Effect.runPromise(
        toRef(key).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die(`No Timmy session for Claude session ${key.sessionId}`),
              onSome: (ref) => repo.append(ref, entries.map(toEntry)),
            }),
          ),
        ),
      ),
    load: (key: SessionKey) =>
      Effect.runPromise(
        toRef(key).pipe(
          Effect.flatMap(Option.match({ onNone: () => Effect.succeedNone, onSome: repo.load })),
          Effect.map(
            Option.match({
              onNone: () => null,
              onSome: (entries) => entries.map((entry) => entry.native).filter(isStoreEntry),
            }),
          ),
        ),
      ),
    listSubkeys: (key) =>
      Effect.runPromise(
        toRef(key).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed<ReadonlyArray<AgentId>>([]),
              onSome: (ref) => repo.subagents(ref.sessionId),
            }),
          ),
          Effect.map((agents) => agents.map((agent) => `subagents/agent-${agent}`)),
        ),
      ),
  };
  return store;
});
