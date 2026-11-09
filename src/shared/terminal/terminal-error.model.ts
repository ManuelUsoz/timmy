import { Schema } from 'effect';

export class TerminalError extends Schema.TaggedError<TerminalError>()('TerminalError', {
  reason: Schema.Literals(['NotFound', 'InvalidCwd', 'InvalidDimensions', 'PtyUnavailable', 'AlreadyClosed', 'AlreadyExists']),
  detail: Schema.String,
}) {}
