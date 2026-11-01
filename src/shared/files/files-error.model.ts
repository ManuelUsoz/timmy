import { Schema } from 'effect';

/** Failures a caller can act on. */
export class FilesError extends Schema.TaggedError<FilesError>()('FilesError', {
  reason: Schema.Literals(['FolderNotFound', 'NotAGitRepository', 'GitUnavailable', 'GitFailed']),
  detail: Schema.String,
}) {}
