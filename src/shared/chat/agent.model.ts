import { Schema } from 'effect';
import { AgentId } from './ids.model';

export const AgentInfo = Schema.Struct({
  id: AgentId,
  /** Absent for the root agent of the session. */
  parentId: Schema.optionalKey(AgentId),
  name: Schema.String,
  /** What the parent delegated, shown as the sub-agent's title. */
  task: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'AgentInfo' });
export type AgentInfo = typeof AgentInfo.Type;

export const AgentOutcome = Schema.Literals(['Completed', 'Failed', 'Cancelled']).annotate({
  identifier: 'AgentOutcome',
});
export type AgentOutcome = typeof AgentOutcome.Type;
