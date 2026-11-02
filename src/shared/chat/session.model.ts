import { Schema } from 'effect';
import { Attachment } from '../attachments/attachment.model';
import { SessionId } from './ids.model';
import { Mention } from './mention.model';
import { Effort, ProviderId } from './provider.model';

export const PermissionMode = Schema.Literals(['Auto', 'AutoAccept', 'Default', 'Plan']).annotate({
  identifier: 'PermissionMode',
});
export type PermissionMode = typeof PermissionMode.Type;

export const SessionOptions = Schema.Struct({
  provider: ProviderId,
  cwd: Schema.String,
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Effort),
  systemPrompt: Schema.optionalKey(Schema.String),
  permissionMode: PermissionMode,
  /** Continue a previous session; only honored when `capabilities.resume`. */
  resume: Schema.optionalKey(SessionId),
  /**
   * Move this stored Session, which has no messages, to `provider`: it keeps its id and its place in the list, and
   * is started again on the active Adapter. Refused when it has messages.
   */
  adopt: Schema.optionalKey(SessionId),
}).annotate({ identifier: 'SessionOptions' });
export type SessionOptions = typeof SessionOptions.Type;

/**
 * What the user sends. `text` is exactly what they typed; `mentions` are the `@path` references in it, resolved by
 * Timmy (the renderer sends none) before the message reaches an adapter.
 */
export const UserMessage = Schema.Struct({
  sessionId: SessionId,
  text: Schema.String,
  mentions: Schema.Array(Mention),
  /** Images added to the message, by id; the Adapter reads the stored files when it sends. */
  attachments: Schema.Array(Attachment),
}).annotate({ identifier: 'UserMessage' });
export type UserMessage = typeof UserMessage.Type;
