import { Schema } from 'effect';
import { AgentInfo, AgentOutcome } from './agent.model';
import { AgentId, MessageId, PermissionRequestId, QuestionRequestId, SessionId, TurnId } from './ids.model';
import { PermissionRequest, PermissionResponse } from './permission.model';
import { ProviderId } from './provider.model';
import { QuestionRequest, QuestionResponse } from './question.model';
import { ToolCall } from './tool-call.model';
import { ContextWindow, Usage } from './usage.model';

export const TurnOutcome = Schema.Literals(['Completed', 'Cancelled', 'Failed', 'MaxTurns']).annotate({
  identifier: 'TurnOutcome',
});
export type TurnOutcome = typeof TurnOutcome.Type;

const sessionFields = { sessionId: SessionId };

/** Everything that can happen in a session, in order. Discriminated by `_tag`. */
export const ChatEvent = Schema.Union([
  Schema.TaggedStruct('SessionStarted', {
    ...sessionFields,
    provider: ProviderId,
    model: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct('TurnStarted', { ...sessionFields, turnId: TurnId }),
  Schema.TaggedStruct('MessageDelta', {
    ...sessionFields,
    agentId: AgentId,
    messageId: MessageId,
    channel: Schema.Literals(['Text', 'Thinking']),
    text: Schema.String,
  }),
  Schema.TaggedStruct('AgentSpawned', { ...sessionFields, agent: AgentInfo }),
  Schema.TaggedStruct('AgentFinished', {
    ...sessionFields,
    agentId: AgentId,
    outcome: AgentOutcome,
    usage: Schema.optionalKey(Usage),
  }),
  Schema.TaggedStruct('ToolCallStarted', { ...sessionFields, call: ToolCall }),
  /** Replaces the call with the same id (status, output, diffs changed). */
  Schema.TaggedStruct('ToolCallUpdated', { ...sessionFields, call: ToolCall }),
  Schema.TaggedStruct('PermissionRequested', { ...sessionFields, request: PermissionRequest }),
  Schema.TaggedStruct('PermissionResolved', {
    ...sessionFields,
    requestId: PermissionRequestId,
    response: PermissionResponse,
  }),
  Schema.TaggedStruct('QuestionAsked', { ...sessionFields, request: QuestionRequest }),
  Schema.TaggedStruct('QuestionResolved', {
    ...sessionFields,
    requestId: QuestionRequestId,
    response: QuestionResponse,
  }),
  /** Cumulative usage; `agentId` absent means the whole session. */
  Schema.TaggedStruct('UsageUpdated', {
    ...sessionFields,
    agentId: Schema.optionalKey(AgentId),
    usage: Usage,
    context: Schema.optionalKey(ContextWindow),
  }),
  Schema.TaggedStruct('TurnFinished', {
    ...sessionFields,
    turnId: TurnId,
    outcome: TurnOutcome,
    /** Human-readable text when `outcome` is `Failed`. */
    detail: Schema.optionalKey(Schema.String),
    usage: Usage,
  }),
]).annotate({ identifier: 'ChatEvent' });
export type ChatEvent = typeof ChatEvent.Type;
