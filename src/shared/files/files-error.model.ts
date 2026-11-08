import { Schema } from 'effect';

/** Failures a caller can act on. */
export class FilesError extends Schema.TaggedError<FilesError>()('FilesError', {
  reason: Schema.Literals(['UnknownProject', 'FolderNotFound', 'FileNotFound', 'Unreadable', 'OutsideProject', 'NotAGitRepository', 'GitUnavailable', 'GitFailed']),
  detail: Schema.String,
}) {}
