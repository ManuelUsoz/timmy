import { Schema } from 'effect';

/** Failures a caller can act on. Provider-internal failures become defects at the adapter. */
export class ChatError extends Schema.TaggedError<ChatError>()('ChatError', {
  reason: Schema.Literals([
    'SessionNotFound',
    'RequestNotFound',
    'AdapterNotReady',
    'AuthMissing',
    'Unsupported',
  ]),
  detail: Schema.String,
}) {}
