import { Schema } from 'effect';
import { AgentId, SessionId } from '../chat/ids.model';
import { ProviderId } from '../chat/provider.model';

/** Timmy's id for a project. Opaque: today derived from the cwd, later the id of a project entity. */
export const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'));
export type ProjectId = typeof ProjectId.Type;

/** The id the provider SDK knows a session by. Never shown to the user; `SessionId` is ours. */
export const ProviderSessionId = Schema.String.pipe(Schema.brand('ProviderSessionId'));
export type ProviderSessionId = typeof ProviderSessionId.Type;

/**
 * Addresses one transcript of a session: the main conversation, or the one of a subagent.
 * Providers keep sidecar transcripts differently (Claude: `subagents/agent-{id}`), so the
 * provider-specific key stays inside the adapter and this is all the domain sees.
 */
export const TranscriptRef = Schema.Struct({
  projectId: ProjectId,
  sessionId: SessionId,
  subagent: Schema.optionalKey(AgentId),
}).annotate({ identifier: 'TranscriptRef' });
export type TranscriptRef = typeof TranscriptRef.Type;

export const SessionSummary = Schema.Struct({
  sessionId: SessionId,
  projectId: ProjectId,
  provider: ProviderId,
  providerSessionId: ProviderSessionId,
  cwd: Schema.String,
  /** The first user message until the user renames the session. */
  title: Schema.String,
  /** Epoch milliseconds. */
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: 'SessionSummary' });
export type SessionSummary = typeof SessionSummary.Type;

/** One line of a stored conversation, already decoded from the provider's native format. */
export const HistoryItem = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Message'),
    role: Schema.Literals(['User', 'Assistant']),
    text: Schema.String,
    timestamp: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal('ToolCall'),
    toolName: Schema.String,
    /** The tool input rendered as JSON. */
    input: Schema.String,
    timestamp: Schema.optionalKey(Schema.String),
  }),
]).annotate({ identifier: 'HistoryItem' });
export type HistoryItem = typeof HistoryItem.Type;
