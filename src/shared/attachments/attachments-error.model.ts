import { Schema } from 'effect';

/** Failures a caller can act on. Storage failures are defects. */
export class AttachmentsError extends Schema.TaggedError<AttachmentsError>()('AttachmentsError', {
  reason: Schema.Literals(['UnsupportedType', 'TooLarge', 'NotFound']),
  detail: Schema.String,
}) {}
