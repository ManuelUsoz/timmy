import { Schema } from 'effect';

export const ProviderId = Schema.Literals(['Claude', 'OpenAI', 'OpenCode', 'Grok']).annotate({
  identifier: 'ProviderId',
});
export type ProviderId = typeof ProviderId.Type;

export const Effort = Schema.Literals(['Default', 'Low', 'Medium', 'High', 'XHigh']).annotate({
  identifier: 'Effort',
});
export type Effort = typeof Effort.Type;

export const ModelInfo = Schema.Struct({
  id: Schema.String,
  efforts: Schema.Array(Effort),
}).annotate({ identifier: 'ModelInfo' });
export type ModelInfo = typeof ModelInfo.Type;

/** What the active adapter can do, so the UI hides what the provider lacks. */
export const AdapterCapabilities = Schema.Struct({
  provider: ProviderId,
  subagents: Schema.Boolean,
  toolCalls: Schema.Boolean,
  permissions: Schema.Boolean,
  questions: Schema.Boolean,
  thinking: Schema.Boolean,
  resume: Schema.Boolean,
}).annotate({ identifier: 'AdapterCapabilities' });
export type AdapterCapabilities = typeof AdapterCapabilities.Type;
