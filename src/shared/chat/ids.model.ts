import { Schema } from 'effect';

export const SessionId = Schema.String.pipe(Schema.brand('SessionId'));
export type SessionId = typeof SessionId.Type;

export const TurnId = Schema.String.pipe(Schema.brand('TurnId'));
export type TurnId = typeof TurnId.Type;

export const AgentId = Schema.String.pipe(Schema.brand('AgentId'));
export type AgentId = typeof AgentId.Type;

export const MessageId = Schema.String.pipe(Schema.brand('MessageId'));
export type MessageId = typeof MessageId.Type;

export const ToolCallId = Schema.String.pipe(Schema.brand('ToolCallId'));
export type ToolCallId = typeof ToolCallId.Type;

export const PermissionRequestId = Schema.String.pipe(Schema.brand('PermissionRequestId'));
export type PermissionRequestId = typeof PermissionRequestId.Type;

export const QuestionRequestId = Schema.String.pipe(Schema.brand('QuestionRequestId'));
export type QuestionRequestId = typeof QuestionRequestId.Type;

/** Id of one question inside a `QuestionRequest`. Unique within its request. */
export const QuestionId = Schema.String.pipe(Schema.brand('QuestionId'));
export type QuestionId = typeof QuestionId.Type;

/** Id of an option inside a permission request or a question. Unique within its request. */
export const OptionId = Schema.String.pipe(Schema.brand('OptionId'));
export type OptionId = typeof OptionId.Type;
