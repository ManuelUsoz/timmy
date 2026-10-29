import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { AgentId, SessionId } from '../chat/ids.model';
import { HistoryItem, SessionSummary, TranscriptRef } from './sessions.model';
import { SessionsError } from './sessions-error.model';

/**
 * Stored sessions, as opposed to `Chat.*` which drives a live one. Resuming a stored
 * session is `Chat.startSession` with `resume` set to its `SessionId`.
 */
export const SessionsRpcs = RpcGroup.make(
  /** Sessions of the project at `cwd`, most recently updated first. */
  Rpc.make('Sessions.list', {
    payload: { cwd: Schema.String },
    success: Schema.Array(SessionSummary),
  }),

  /** The conversation of a session, or of one of its subagents when `ref.subagent` is set. */
  Rpc.make('Sessions.history', {
    payload: { ref: TranscriptRef },
    success: Schema.Array(HistoryItem),
    error: SessionsError,
  }),

  /** Subagents that have a stored transcript in the session. */
  Rpc.make('Sessions.listSubagents', {
    payload: { sessionId: SessionId },
    success: Schema.Array(AgentId),
    error: SessionsError,
  }),

  Rpc.make('Sessions.rename', {
    payload: { sessionId: SessionId, title: Schema.String },
    success: Schema.Void,
    error: SessionsError,
  }),

  /** Deletes the session and its subagent transcripts. Fails with `SessionActive` while it is open. */
  Rpc.make('Sessions.delete', {
    payload: { sessionId: SessionId },
    success: Schema.Void,
    error: SessionsError,
  }),

  /** Pushes an item whenever stored sessions change (created, titled, renamed, deleted, updated). Refetch `Sessions.list`. */
  Rpc.make('Sessions.changes', {
    success: Schema.Void,
    stream: true,
  }),
);
