import { Schema } from 'effect';
import { AgentId, OptionId, PermissionRequestId } from './ids.model';
import { ToolCall } from './tool-call.model';

export const PermissionOptionKind = Schema.Literals([
  'AllowOnce',
  'AllowAlways',
  'RejectOnce',
  'RejectAlways',
]).annotate({ identifier: 'PermissionOptionKind' });
export type PermissionOptionKind = typeof PermissionOptionKind.Type;

export const PermissionOption = Schema.Struct({
  id: OptionId,
  label: Schema.String,
  kind: PermissionOptionKind,
}).annotate({ identifier: 'PermissionOption' });
export type PermissionOption = typeof PermissionOption.Type;

/** The agent wants to run `toolCall` and waits for the user to pick one option. */
export const PermissionRequest = Schema.Struct({
  id: PermissionRequestId,
  agentId: AgentId,
  toolCall: ToolCall,
  options: Schema.NonEmptyArray(PermissionOption),
}).annotate({ identifier: 'PermissionRequest' });
export type PermissionRequest = typeof PermissionRequest.Type;

export const PermissionResponse = Schema.Union([
  Schema.TaggedStruct('Selected', { requestId: PermissionRequestId, optionId: OptionId }),
  Schema.TaggedStruct('Cancelled', { requestId: PermissionRequestId }),
]).annotate({ identifier: 'PermissionResponse' });
export type PermissionResponse = typeof PermissionResponse.Type;
