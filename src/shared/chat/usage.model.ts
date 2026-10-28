import { Schema } from 'effect';

/** Token and cost counters. Optional fields are omitted when the provider does not report them. */
export const Usage = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  cacheReadTokens: Schema.optionalKey(Schema.Int),
  cacheWriteTokens: Schema.optionalKey(Schema.Int),
  reasoningTokens: Schema.optionalKey(Schema.Int),
  costUsd: Schema.optionalKey(Schema.Number),
  durationMs: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: 'Usage' });
export type Usage = typeof Usage.Type;

/** Context window fill, for the "x% used" indicator. */
export const ContextWindow = Schema.Struct({
  usedTokens: Schema.Int,
  maxTokens: Schema.Int,
}).annotate({ identifier: 'ContextWindow' });
export type ContextWindow = typeof ContextWindow.Type;
