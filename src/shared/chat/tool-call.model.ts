import { Schema } from 'effect';
import { AgentId, ToolCallId } from './ids.model';

export const ToolKind = Schema.Literals([
  'Read',
  'Edit',
  'Write',
  'Delete',
  'Search',
  'Execute',
  'Fetch',
  'Think',
  'Other',
]).annotate({ identifier: 'ToolKind' });
export type ToolKind = typeof ToolKind.Type;

export const ToolStatus = Schema.Literals(['Pending', 'Running', 'Completed', 'Failed']).annotate({
  identifier: 'ToolStatus',
});
export type ToolStatus = typeof ToolStatus.Type;

/** A file a tool call touches. `line` is 1-based when known. */
export const FileLocation = Schema.Struct({
  path: Schema.String,
  line: Schema.optionalKey(Schema.Int),
}).annotate({ identifier: 'FileLocation' });
export type FileLocation = typeof FileLocation.Type;

/** A change a tool made or wants to make, for rendering a diff. */
export const FileDiff = Schema.Struct({
  path: Schema.String,
  /** Absent when the file is new. */
  oldText: Schema.optionalKey(Schema.String),
  newText: Schema.String,
}).annotate({ identifier: 'FileDiff' });
export type FileDiff = typeof FileDiff.Type;

export const ToolCall = Schema.Struct({
  id: ToolCallId,
  agentId: AgentId,
  /** Provider tool name, e.g. `Read`, `Bash`. */
  name: Schema.String,
  kind: ToolKind,
  /** One-line summary for the UI, e.g. `Edit src/app.ts`. */
  title: Schema.String,
  status: ToolStatus,
  locations: Schema.Array(FileLocation),
  diffs: Schema.Array(FileDiff),
  /** Text output (stdout, file excerpt) once available. */
  output: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'ToolCall' });
export type ToolCall = typeof ToolCall.Type;
