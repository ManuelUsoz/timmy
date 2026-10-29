import { Schema } from 'effect';

/** Failures a caller can act on. Storage failures are defects. */
export class SessionsError extends Schema.TaggedError<SessionsError>()('SessionsError', {
  reason: Schema.Literals(['SessionNotFound', 'SessionActive', 'InvalidTitle']),
  detail: Schema.String,
}) {}
